const { execSync } = require("child_process");
// try {
execSync("npm install @octokit/core @actions/github", {
  stdio: "inherit",
});
// }
// catch (error) {
// console.error('Failed to install dependencies:', error)
// }

const { Octokit } = require("@octokit/core");
const github = require("@actions/github");

const PULL_REQUEST = github.context.payload.pull_request;
const AUTOMERGE_BRANCHES = process.env.AUTOMERGE_BRANCHES;
const AUTOMERGE_LABEL = "automerge";

const octokit = new Octokit({
  auth: `${process.env.GH_TOKEN}`,
  baseUrl: `https://api.github.com/repos/${github.context.payload.repository.full_name}`,
  headers: {
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github.v3+json",
  },
});

async function deleteBranch(branchName) {
  await octokit.request("DELETE /git/refs/heads/{branchName}", {
    branchName,
  });
}

const getAutomaticPRConfig = (head, base, author, failedBranch = undefined) => {
  let title = PULL_REQUEST.title;
  let body = PULL_REQUEST.body;
  if (PULL_REQUEST.title.includes("[automerge]")) {
    const regexTitle = /\[automerge\]\s*\[[^\]]+]\s*(.+)/;
    const matchTitle = regexTitle.exec(PULL_REQUEST.title);
    const regexBody = /.+Authored\s+by\s+(\w+)\s+([\s\S]*)/;
    const matchBody = regexBody.exec(PULL_REQUEST.body);
    title = matchTitle[1];
    body = matchBody[2];
  }
  return {
    title: `[automerge][${head} -> ${failedBranch ? failedBranch : base}]${
      failedBranch ? " FAILED " : ""
    } ${title}`,
    body: `Triggered by [PR ${PULL_REQUEST.number}](${PULL_REQUEST.html_url}) merge. Authored by ${author}\n\n${body}`,
  };
};

async function createPR(base, head, author, failedBranch = undefined) {
  const titleBody = getAutomaticPRConfig(head, base, author, failedBranch);
  console.log(`getAutomaticPRConfig: ${JSON.stringify(titleBody, null, 2)}`);
  const { data } = await octokit.request("POST /pulls", {
    ...titleBody,
    head: head,
    base: base,
    maintainer_can_modify: true,
  });
  return data;
}
async function createPullRequest(base, head) {
  let author = PULL_REQUEST.user.login;
  if (PULL_REQUEST.title.includes("automerge")) {
    const regex = /.+Authored\s+by\s+(\w+)\s+([\s\S]*)/;
    const match = regex.exec(PULL_REQUEST.body);
    author = match[1];
  }
  const response = await createPR(base, head, author);
  // console.log(`response: ${response.data.number}`)
  const prNumber = response.number;
  await octokit.request("POST /issues/{prNumber}/labels", {
    prNumber,
    labels: [AUTOMERGE_LABEL],
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log("Pull request created:", response.html_url);

  const pr = await octokit.request("GET /pulls/{prNumber}", {
    prNumber,
  });

  // if conflicts then we close created PR and open a new one
  // with original feature branch merging into a new branch created from target branch
  // in order ro resolve conflicts
  if (pr.data.mergeable === false || pr.data.mergeable_state === "dirty") {
    console.log(`PR ${prNumber} has merge conflicts`);
    const newBranchName = `conflict-resolution-${base}-${head}`;
    await createBranchFrom(base, newBranchName);
    const responseOnFailure = await createPR(base, newBranchName, author);

    const prOnFailureNum = responseOnFailure.number;
    await closePullRequest(prNumber);
    const authors = (await getPullRequestUsers(PULL_REQUEST.number))
      .concat([author])
      .filter((v, i, arr) => i !== arr.indexOf(v));
    if (authors.length > 0) {
      await assignPullRequest(prOnFailureNum, authors);
    } else {
      console.log("Authors could not be found. PR will not be assigned.");
    }
    return prOnFailureNum;
  }
  return prNumber;

  // await isMergeable(head, base)
  // return prNumber
  // } catch (error) {
  //     handleCatch('Error creating pull request:', error)
  //     throw ('Error creating pull request:', error)
  // }
}

const createBranchFrom = async (branchName, newBranchName) => {
  //   try {
  // Get the commit SHA of the existing branch
  const branchData = await octokit.request("GET /git/refs/heads/{branchName}", {
    branchName,
  });

  const sha = branchData.data.object.sha;

  // Create a new branch reference pointing to the same commit SHA
  await octokit.request("POST /git/refs", {
    ref: `refs/heads/${newBranchName}`,
    sha: sha,
  });

  console.log(`Branch created: ${newBranchName}`);

  // Get the tree SHA using the commit SHA
  const commitData = await octokit.request("GET /git/commits/{sha}", {
    sha,
  });
  const treeSha = commitData.data.tree.sha;

  // Create a new commit using the tree SHA
  const newCommitData = await octokit.request("POST /git/commits", {
    message: "This is an empty commit",
    tree: treeSha,
    parents: [sha],
  });

  // Update the branch to point to the new commit
  await octokit.request("PATCH /git/refs/heads/{newBranchName}", {
    newBranchName,
    sha: newCommitData.data.sha,
  });
  console.log(
    `Empty commit created on the new branch: ${newCommitData.data.sha}`
  );
  //   } catch (error) {
  //     console.error(`Error: ${error.message}`);
  //     console.log("Request Config:", error.config);
  //     if (error.response) {
  //       console.log("Error Response:", error.response.data);
  //     }
  //   }
};

const getPullRequestUsers = async (prNumber) => {
  // try {
  // Get the latest commit on the head branch
  const commitsResponse = await octokit.request(
    "GET /pulls/{prNumber}/commits",
    {
      prNumber,
    }
  );

  // Extract the author's GitHub username
  const authors = commitsResponse.data.map((commit) => commit.author.login);
  console.log(`authors: ${authors}`);

  return authors;
  // } catch (error) {
  //     console.error('Error retrieving PR author:', error)
  // return null
  // }
};

const assignPullRequest = async (prOnFailureNum, assignees) => {
  // try {
  await octokit.request("POST /issues/{prOnFailureNum}/assignees", {
    prOnFailureNum,
    assignees,
  });

  console.log(`PR #${prOnFailureNum} assigned to ${assignees}`);
  // } catch (error) {
  // console.error(`Error assigning PR #${prOnFailureNum} to ${assignees}:`)
  // }
};

const closePullRequest = async (prNumber) => {
  // try {
  await octokit.request("POST /pulls/{prNumber}", {
    prNumber,
    state: "closed",
  });

  console.log(`PR closed: #${prNumber}`);
  // } catch (error) {
  //     console.error('Error closing PR:', error)
  // }
};

async function isPullRequestReadyToMerge(prNumber) {
  //   return true;
  // try {
  // Get pull request information
  const prResponse = await octokit.request("GET /pulls/{prNumber}", {
    prNumber,
  });

  const prData = prResponse.data;

  // Check if the PR is mergeable and not a draft
  if (prData.draft || !prData.mergeable) {
    throw `Pull request is not ready to merge (Draft: ${prData.draft}/Merge conflicts: ${prData.mergeable})`;
  } else if (prData.mergeable_state !== "clean") {
    if (prData.mergeable_state === "unstable") {
      console.log(
        "The mergeable_state is unstable. Checking if all required checks succeeded."
      );
      const requiredStatusChecks = await octokit.request(
        "GET /branches/{base}/protection/required_status_checks",
        {
          base: PULL_REQUEST.base.ref,
        }
      );
      //   requiredStatusChecks.data.contexts
      const checkRuns = await octokit.request("GET /commits/{sha}/check-runs", {
        sha: PULL_REQUEST.head.sha,
      });
      const failedCheckRuns = checkRuns.data.check_runs.filter((checkRun) => {
        checkRun.name in requiredStatusChecks ||
          checkRun.conclusion === "success";
      });
      if (!failedCheckRuns.length) {
        console.log(
          "All required checks succeeded. Set commit status = success"
        );
        const result = await octokit.request("POST /statuses/{sha}", {
          sha: PULL_REQUEST.head.sha,
          state: "success",
          target_url: PULL_REQUEST.html_url,
          description: "The build succeeded!",
          context: "automerge-automation",
        });
      } else {
        failedCheckRuns.forEach((c) => {
          throw `Following required checks failed:\n${html_url.join("\n")}`;
        });
      }
    } else if (
      prData.mergeable_state === "blocked" &&
      prData.title.startsWith("[automerge]")
    ) {
      console.log(
        "The mergeable_state is expected to be blocked in automatically created pull request"
      );
    } else {
      throw `Pull request is not ready to merge: mergeable_state=${prData.mergeable_state}`;
    }
  }

  if (!prData.title.startsWith("[automerge]")) {
    // Get reviews for the pull request
    const reviewsResponse = await octokit.request(
      "GET /pulls/{prNumber}/reviews",
      {
        prNumber,
      }
    );
    const reviewsData = reviewsResponse.data;

    // Check for at least one approved review and no changes requested
    const changesRequested = reviewsData.some(
      (review) => review.state === "CHANGES_REQUESTED"
    );
    const approved = reviewsData.some((review) => review.state === "APPROVED");

    if (changesRequested || !approved) {
      console.log("Pull request does not have the necessary reviews");
      return false;
    }
  }

  // Get the combined status for the head commit of the PR
  const statusResponse = await octokit.request(
    "GET /commits/{commitSha}/status",
    {
      commitSha: prData.head.sha,
    }
  );

  const statusData = statusResponse.data;

  // Check for successful status checks
  if (statusData.state !== "success") {
    console.log("Status checks have not passed");
    return false;
  }

  // If all checks above pass, the PR is ready to merge
  console.log("Pull request is ready to merge");
  return true;
  // } catch (error) {
  //     handleCatch(
  //         'Error checking if the pull request is ready to merge:',
  //         error
  //     )
  //     throw ('Error checking if the pull request is ready to merge:', error)
  // }
}

async function mergePullRequest() {
  // try {
  // await isPullRequestReadyToMerge(PULL_REQUEST.number)
  if (await isPullRequestReadyToMerge(PULL_REQUEST.number)) {
    const mergeResponse = await octokit.request("PUT /pulls/{prNumber}/merge", {
      prNumber: PULL_REQUEST.number,
      commit_title: `Automerge PR #${PULL_REQUEST.number}`,
      commit_message: "Automatically merged by GitHub Actions",
      merge_method: "merge",
    });
    if (mergeResponse.status === 200) {
      console.log(`Successfully merged PR #${PULL_REQUEST.number}`);
    } else {
      console.error("Failed to merge PR:", mergeResponse.data);
    }
    return mergeResponse;
  } else {
  }
  return null;
  // } catch (error) {
  //     handleCatch('Error merging pull request:', error)
  //     throw ('Error merging pull request:', error)
  // }
}

const getNextBranchForPR = (currentBranch, allBranches) => {
  const branchesArray = allBranches.split(",");
  const currentIndex = branchesArray.indexOf(currentBranch);
  return currentIndex < branchesArray.length - 1
    ? branchesArray[currentIndex + 1]
    : null;
};

(async () => {
  const sourceBranch = PULL_REQUEST ? PULL_REQUEST.head.ref : null;
  const labels = PULL_REQUEST
    ? PULL_REQUEST.labels.map((label) => label.name)
    : [];

  if (labels.includes(AUTOMERGE_LABEL)) {
    const prMergeResult = await mergePullRequest();
    if (prMergeResult) {
      const nextBranch = getNextBranchForPR(
        PULL_REQUEST.base.ref,
        AUTOMERGE_BRANCHES
      );
      // If you want to delete the branch after merging
      ("Pull request was created ");

      if (nextBranch === null) {
        await deleteBranch(sourceBranch);
      } else {
        const pullRequest = await createPullRequest(nextBranch, sourceBranch);
      }
    }
  } else {
    console.log("PR does not have the automerge label. Skipping action.");
  }
})();

// function handleCatch(message, error) {
//   if (error.response) {
//     console.error(message, " Error data: ", error.response.data);
//     console.error(message, " Error status: ", error.response.status);
//   } else if (error.request) {
//     console.error(message, " Error request: ", error.request);
//   } else {
//     console.error(message, " Error message: ", error.message);
//   }
// }

// async function getGitRevListCount() {
//   const command = "git rev-list --count --all";
//   const result = await executeCommand(command);

//   if (result.stderr) {
//     console.error("Error executing git command:", result.stderr);
//     throw new Error(result.stderr); // Throw an Error object with the stderr message
//   }

//   return result.stdout; // Return the stdout which contains the count
// }

// async function createBranch(branchName, baseBranch) {
//   // try {
//   // Check if the branch already exists
//   if (await branchExists(branchName)) {
//     // If it exists, delete it
//     await deleteBranch(branchName);
//   }
//   // Get the SHA of the latest commit on the base branch
//   const { data: refData } = await githubAxios.get(
//     `/repos/${OWNER_REPO}/git/ref/heads/${baseBranch}`
//   );

//   const sha = refData.object.sha;

//   // Create a new branch
//   const { data: newBranch } = await githubAxios.post(
//     `/repos/${OWNER_REPO}/git/refs`,
//     {
//       ref: `refs/heads/${branchName}`,
//       sha,
//     }
//   );

//   console.log(`Branch created: ${branchName}`);
//   return newBranch.ref;
//   // } catch (error) {
//   //     handleCatch('Error creating branch:', error)
//   //     throw ('Error creating branch:', error)
//   // }
// }
