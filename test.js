const axios = require("axios");

const { Octokit } = require("@octokit/rest");
process.env.INPUT_OWNER_REPO = "mtuktarov/gha";
const octokit = new Octokit({
  auth: `${process.env.GITHUB_TOKEN}`,
  baseUrl: `https://api.github.com/repos/${process.env.INPUT_OWNER_REPO}`,
  headers: {
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github.v3+json",
  },
});
(async () => {
  const result = await octokit.request("POST /statuses/{sha}", {
    sha: "5f7da11d2148062b2badd7917cc3a0a81f7c653b",
    state: "success",
    target_url: "https://example.com/build/status",
    description: "The build succeeded!",
    context: "continuous-integration/jenkins",
  });
  console.log(result.data);
})();
