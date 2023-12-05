const axios = require("axios");

const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: `${process.env.GITHUB_TOKEN}`,
  baseUrl: `https://api.github.com/repos/${process.env.INPUT_OWNER_REPO}`,
  headers: {
    Accept: "application/vnd.github.v3+json",
  },
});
