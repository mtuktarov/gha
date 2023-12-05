const { Octokit } = require("@octokit/core");
const github = require("@actions/github");

const PULL_REQUEST = github.context.payload.pull_request;

const octokit = new Octokit({
  auth: `${process.env.GITHUB_TOKEN}`,
  baseUrl: `https://api.github.com/repos/mtuktarov/gha`,
  headers: {
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github.v3+json",
  },
});

const checkIfActionIsAlreadyRunning = async () => {
  //   const checkRuns = await octokit.request("GET /commits/{sha}/check-runs", {
  //     sha: PULL_REQUEST.head.sha,
  //   });
  // For every relevant run:

  //   for (var run of checkRuns.data.check_runs) {
  // if (run.app.slug == "github-actions") {
  // const job = await octokit.request("GET /actions/jobs/{jobId}", {
  //   jobId: "7104237331",
  // });

  // Now, get the Actions run that this job is in.
  const actionsRun = await octokit.request("GET /actions/runs/{runId}", {
    runId: "7104237331",
  });
  console.log(actionsRun);
  const activeWorkflowsRuns = [];
  if (actionsRun.data.event == "pull_request") {
    if (actionsRun.data.status != "completed") {
      activeWorkflowsRuns.push(actionsRun.data);
    }
  }
  activeWorkflowsRuns.forEach(async (run) => {
    await octokit.request("POST /actions/runs/{runId}/cancel", {
      runId: run.id,
    });
  });
  // }
};

(async () => {
  await checkIfActionIsAlreadyRunning();

  // console.log(result.data);
})();
