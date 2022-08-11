# ci-info-action

GitHub Actiions for [ci-info](https://github.com/suzuki-shunsuke/ci-info).
This is useful to decrease GitHub API call by caching ci-info result.

ci-info-action has two actions.

* [store](store): Run ci-info and save the result as an artifact
* [restore](restore): Restore ci-info result from an artifact

## :warning: This action doesn't install ci-info

`store` action depends on ci-info, so you have to [install ci-info yourself](https://github.com/suzuki-shunsuke/ci-info#install).
`restore` action depends on `store` action, but doesn't depend on ci-info.

## LICENSE

[MIT](LICENSE)
