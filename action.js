const axios = require('axios');

const githubToken = process.env.GITHUB_TOKEN;
const owner = process.env.INPUT_OWNER;
const repo = process.env.INPUT_REPO;
const headBranch = process.env.INPUT_HEAD_BRANCH;
const baseBranch = process.env.INPUT_BASE_BRANCH;

const createPullRequest = async () => {
  try {
    const response = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        title: "Amazing new feature",
        body: "Please pull this in!",
        head: headBranch,
        base: baseBranch
      },
      {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );
    console.log('Pull request created:', response.data.html_url);
    return response.data.number; // Возвращает номер созданного Pull Request
  } catch (error) {
    console.error('Error creating pull request:', error.response.data);
  }
};


const mergePullRequest = async (pullNumber) => {
    try {
      const response = await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
        {
          commit_title: "Merging my amazing feature",
          commit_message: "Doing the merge via REST API",
          merge_method: "merge"
        },
        {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );
      console.log('Pull request merged:', response.data);
    } catch (error) {
      console.error('Error merging pull request:', error.response.data);
    }
  };
createPullRequest().then(pullNumber => {
  if (pullNumber) {
    mergePullRequest(pullNumber);
  }
});

createPullRequest().then(pullNumber => {
    if (pullNumber) {
      mergePullRequest(pullNumber);
    }
  });