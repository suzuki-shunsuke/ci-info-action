import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

interface Inputs {
  owner: string;
  repo: string;
  pr?: number;
  sha?: string;
  token: string;
  dir?: string;
  prefix: string;
}

interface PRInfo {
  number: number;
  base_ref: string;
  head_ref: string;
  author: string;
  merged: boolean;
}

interface PRFile {
  filename: string;
  previous_filename?: string;
}

const getInputs = (): Inputs => {
  const ctx = github.context;

  // Get inputs with fallbacks from context
  const owner = core.getInput("owner") || ctx.repo.owner;
  const repo = core.getInput("repo") || ctx.repo.repo;
  const prInput = core.getInput("pr");
  const pr = prInput ? parseInt(prInput, 10) : ctx.payload.pull_request?.number;
  const sha = core.getInput("sha") || ctx.sha;
  const token = core.getInput("github_token", {
    required: true,
  });
  const dir = core.getInput("dir");
  const prefix = core.getInput("prefix");

  return { owner, repo, pr, sha, token, dir, prefix };
};

const getPRNumberFromMergeGroup = (): number | undefined => {
  const refName = process.env.GITHUB_REF_NAME;
  if (!refName) {
    return undefined;
  }

  // GITHUB_REF_NAME format for merge_group: pr-<number>-<sha>
  // e.g., "pr-123-abc123"
  const withoutPrefix = refName.replace(/^pr-/, "");
  const dashIndex = withoutPrefix.indexOf("-");

  if (dashIndex === -1) {
    core.warning(
      `GITHUB_REF_NAME is not a valid merge_group format: ${refName}`,
    );
    return undefined;
  }

  const prNumberStr = withoutPrefix.substring(0, dashIndex);
  const prNumber = parseInt(prNumberStr, 10);

  if (isNaN(prNumber)) {
    core.warning(`Failed to parse PR number from GITHUB_REF_NAME: ${refName}`);
    return undefined;
  }

  return prNumber;
};

const getPRNumberFromSHA = async (
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  sha: string,
): Promise<number | undefined> => {
  try {
    const { data } =
      await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: sha,
      });

    if (data.length === 0) {
      return undefined;
    }

    return data[0].number;
  } catch (error) {
    core.warning(`Failed to get PR from SHA: ${error}`);
    return undefined;
  }
};

const getPRFiles = async (
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRFile[]> => {
  const maxPerPage = 100;
  const maxFiles = 3000;
  const files: PRFile[] = [];

  let page = 1;
  while (files.length < maxFiles) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: maxPerPage,
      page,
    });

    if (data.length === 0) {
      break;
    }

    files.push(
      ...data.map((f) => ({
        filename: f.filename,
        previous_filename: f.previous_filename,
      })),
    );

    if (data.length < maxPerPage) {
      break;
    }

    page++;

    if (files.length >= maxFiles) {
      break;
    }
  }

  return files.slice(0, maxFiles);
};

const setOutputsAndEnv = (
  inputs: Inputs,
  prInfo?: PRInfo,
  tempDir?: string,
) => {
  const isPR = inputs.pr !== undefined;
  const hasAssociatedPR = prInfo !== undefined;

  const setValue = (key: string, value: any) => {
    core.setOutput(key, value);
    core.exportVariable(`${inputs.prefix}${key.toUpperCase()}`, value);
  };

  setValue("is_pr", isPR);
  setValue("has_associated_pr", hasAssociatedPR);
  setValue("repo_owner", inputs.owner);
  setValue("repo_name", inputs.repo);

  if (prInfo) {
    setValue("pr_number", prInfo.number);
    setValue("base_ref", prInfo.base_ref);
    setValue("head_ref", prInfo.head_ref);
    setValue("pr_author", prInfo.author);
    setValue("pr_merged", prInfo.merged);
  }

  if (tempDir) {
    setValue("temp_dir", tempDir);
  }
};

const writeOutputFiles = async (dir: string, prData: any, files: PRFile[]) => {
  await fs.mkdir(dir, { recursive: true });

  // Write pr.json
  await fs.writeFile(
    path.join(dir, "pr.json"),
    JSON.stringify(prData, null, 2),
  );

  // Write pr_files.json
  await fs.writeFile(
    path.join(dir, "pr_files.json"),
    JSON.stringify(files, null, 2),
  );

  // Write pr_files.txt
  const filenames = files.map((f) => f.filename).join("\n");
  await fs.writeFile(path.join(dir, "pr_files.txt"), filenames);

  // Write pr_all_filenames.txt (including previous_filename for renames)
  const allFilenames = new Set<string>();
  files.forEach((f) => {
    allFilenames.add(f.filename);
    if (f.previous_filename) {
      allFilenames.add(f.previous_filename);
    }
  });
  await fs.writeFile(
    path.join(dir, "pr_all_filenames.txt"),
    Array.from(allFilenames).join("\n"),
  );

  // Write labels.txt
  const labels = (prData.labels || []).map((l: any) => l.name).join("\n");
  await fs.writeFile(path.join(dir, "labels.txt"), labels);
};

export const main = async () => {
  const inputs = getInputs();

  core.info(`Repository: ${inputs.owner}/${inputs.repo}`);

  // Determine PR number
  let prNumber = inputs.pr;

  const octokit = github.getOctokit(inputs.token);

  // Try to get PR number from merge_group event
  if (!prNumber && github.context.eventName === "merge_group") {
    core.info("Attempting to get PR number from merge_group event");
    prNumber = getPRNumberFromMergeGroup();
  }

  // Try to get PR number from SHA
  if (!prNumber && inputs.sha) {
    prNumber = await getPRNumberFromSHA(
      octokit,
      inputs.owner,
      inputs.repo,
      inputs.sha,
    );
  }

  if (!prNumber) {
    core.info("No PR number found - running in non-PR environment");
    setOutputsAndEnv(inputs);
    return;
  }

  // Get PR details
  core.info(`Fetching PR #${prNumber}`);
  const { data: prData } = await octokit.rest.pulls.get({
    owner: inputs.owner,
    repo: inputs.repo,
    pull_number: prNumber,
  });

  const prInfo: PRInfo = {
    number: prData.number,
    base_ref: prData.base.ref,
    head_ref: prData.head.ref,
    author: prData.user?.login || "",
    merged: prData.merged || false,
  };

  // Get PR files
  core.info("Fetching PR files");
  const files = await getPRFiles(octokit, inputs.owner, inputs.repo, prNumber);
  core.info(`Found ${files.length} files`);

  // Determine output directory
  const outputDir =
    inputs.dir || (await fs.mkdtemp(path.join(os.tmpdir(), "ci-info")));

  // Write output files
  await writeOutputFiles(outputDir, prData, files);
  core.info(`Output files written to: ${outputDir}`);

  // Set outputs and environment variables
  setOutputsAndEnv(inputs, prInfo, outputDir);

  core.info("CI info collection completed successfully");
};
