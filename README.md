# ci-info-action

GitHub Actiions for [ci-info](https://github.com/suzuki-shunsuke/ci-info).
This is useful to decrease GitHub API call by caching ci-info result.

ci-info-action has two actions.

* [store](store): Run ci-info and save the result as an artifact
* [restore](restore): Restore ci-info result from an artifact

## :warning: This action doesn't install ci-info

`store` action depends on ci-info, so you have to [install ci-info yourself](https://github.com/suzuki-shunsuke/ci-info#install).
`restore` action depends on `store` action, but doesn't depend on ci-info.

## Example

```yaml
jobs:
  ci-info:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # Install ci-info with aqua
      - uses: aquaproj/aqua-installer@v1.1.1
        with:
          aqua_version: v1.19.1

      # Run ci-info and store the result as an artifact
      - uses: suzuki-shunsuke/ci-info-action/store@main

      # Refer ci-info result
      - run: echo "$CI_INFO_PR_NUMBER"

  test:
    needs: ci-info
    strategy:
      matrix:
        env:
          - runs-on: windows-latest
          - runs-on: ubuntu-latest
    runs-on: ${{ matrix.env.runs-on }}
    steps:
      - uses: actions/checkout@v3

      # Restore ci-info result from an artifact
      - uses: suzuki-shunsuke/ci-info-action/restore@main

      # Refer ci-info result
      - run: echo "$CI_INFO_PR_NUMBER"
```

## LICENSE

[MIT](LICENSE)
