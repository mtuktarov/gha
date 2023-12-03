const { execSync } = require('child_process')
// try {
execSync('npm install axios @actions/github', {
    stdio: 'inherit',
})
// }
// catch (error) {
// console.error('Failed to install dependencies:', error)
// }

const axios = require('axios')
const github = require('@actions/github')

const OWNER_REPO = process.env.INPUT_OWNER_REPO

const githubAxios = axios.create({
    baseURL: 'https://api.github.com/',
    headers: {
        Authorization: `token ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
    },
})

const PULL_REQUEST = github.context.payload.pull_request
const AUTOMERGE_BRANCHES = process.env.AUTOMERGE_BRANCHES
const AUTOMERGE_LABEL = 'automerge'

function handleCatch(message, error) {
    if (error.response) {
        console.error(message, ' Error data: ', error.response.data)
        console.error(message, ' Error status: ', error.response.status)
    } else if (error.request) {
        console.error(message, ' Error request: ', error.request)
    } else {
        console.error(message, ' Error message: ', error.message)
    }
}

async function getGitRevListCount() {
    const command = 'git rev-list --count --all'
    const result = await executeCommand(command)

    if (result.stderr) {
        console.error('Error executing git command:', result.stderr)
        throw new Error(result.stderr) // Throw an Error object with the stderr message
    }

    return result.stdout // Return the stdout which contains the count
}

async function deleteBranch(branchName) {
    // try {
    await githubAxios.delete(
        `/repos/${OWNER_REPO}/git/refs/heads/${branchName}`
    )
    console.log(`Branch deleted: ${branchName}`)
    // } catch (error) {
    //     console.error('Error deleting branch:', error)
    // }
}

async function createBranch(branchName, baseBranch) {
    // try {
    // Check if the branch already exists
    if (await branchExists(branchName)) {
        // If it exists, delete it
        await deleteBranch(branchName)
    }
    // Get the SHA of the latest commit on the base branch
    const { data: refData } = await githubAxios.get(
        `/repos/${OWNER_REPO}/git/ref/heads/${baseBranch}`
    )

    const sha = refData.object.sha

    // Create a new branch
    const { data: newBranch } = await githubAxios.post(
        `/repos/${OWNER_REPO}/git/refs`,
        {
            ref: `refs/heads/${branchName}`,
            sha,
        }
    )

    console.log(`Branch created: ${branchName}`)
    return newBranch.ref
    // } catch (error) {
    //     handleCatch('Error creating branch:', error)
    //     throw ('Error creating branch:', error)
    // }
}

async function createPullRequest(base, head, onSuccess, labels = undefined) {
    // try {

    const response = await axios.post(
        `https://api.github.com/repos/${OWNER_REPO}/pulls`,
        {
            ...getAutomaticPRConfig(head, base, onSuccess),
            head: head,
            base: base,
            maintainer_can_modify: true,
        },
        {
            headers: {
                Authorization: `token ${process.env.GH_TOKEN}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        }
    )

    // console.log(`response: ${response.data.number}`)
    const prNumber = response.data.number
    if (labels?.length > 0) {
        await githubAxios.post(
            `/repos/${OWNER_REPO}/issues/${prNumber}/labels`,
            {
                labels,
            }
        )
    }
    await new Promise((resolve) => setTimeout(resolve, 10000))
    console.log('Pull request created:', response.data.html_url)
    // await checkMergeability(prNumber, head, base)
    return prNumber
    // } catch (error) {
    //     handleCatch('Error creating pull request:', error)
    //     throw ('Error creating pull request:', error)
    // }
}

const createBranchFrom = async (branchName, newBranchName) => {
    const branchRef = `refs/heads/${branchName}`
    const newBranchRef = `refs/heads/${newBranchName}`
    // try {
    // Get the SHA of the latest commit in the base branch
    const branchData = await githubAxios.get(
        `/repos/${OWNER_REPO}/git/${branchRef}`
    )
    const sha = branchData.data.object.sha

    // Create the new branch with the same SHA
    await githubAxios.post(`/repos/${OWNER_REPO}/git/refs`, {
        ref: newBranchRef,
        sha: sha,
    })

    console.log(`Branch created: ${newBranchName}`)
    // } catch (error) {
    //     console.error('Error creating new branch:', error)
    // }
}

const getPullRequestUsers = async (head) => {
    // try {
    // Get the latest commit on the head branch
    const commitsResponse = await githubAxios.get(
        `/repos/${OWNER_REPO}/commits?sha=${head}&per_page=1`
    )
    const latestCommits = commitsResponse.data
    // Extract the author's GitHub username

    const authors = latestCommits
        .map((commit) => commit.author.login)
        .concat([PULL_REQUEST.merged_by, PULL_REQUEST.user])
        .filter((v, i, arr) => i !== arr.indexOf(v))

    return authors
    // } catch (error) {
    //     console.error('Error retrieving PR author:', error)
    // return null
    // }
}

const assignPullRequest = async (assignees) => {
    // try {
    await githubAxios.post(
        `/repos/${OWNER_REPO}/issues/${PULL_REQUEST.number}/assignees`,
        { assignees: assignees }
    )
    console.log(`PR #${PULL_REQUEST.number} assigned to ${assignee}`)
    // } catch (error) {
    console.error(
        `Error assigning PR #${PULL_REQUEST.number} to ${assignee}:`,
        error
    )
    // }
}

const closePullRequest = async (prNumber) => {
    // try {
    await githubAxios.patch(`/repos/${OWNER_REPO}/pulls/${prNumber}`, {
        state: 'closed',
    })

    console.log(`PR closed: #${prNumber}`)
    // } catch (error) {
    //     console.error('Error closing PR:', error)
    // }
}

const isMergeable = async (prNumber, head, base) => {
    // try {
    // Wait for GitHub to calculate mergeability
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const pr = await githubAxios.get(`/repos/${OWNER_REPO}/pulls/${prNumber}`)
    if (pr.data.mergeable === false) {
        console.log(`PR has merge conflicts: ${prNumber}`)
        const newBranchName = `conflict-resolution-${base}-${Date.now()}`
        await createBranchFrom(base, newBranchName)

        const prFailureNumber = await createPullRequest(
            newBranchName,
            head,
            false
        )
        await closePullRequest(prFailureNumber)
        const prUsers = await getPullRequestUsers(head)
        if (authors.length > 0) {
            await assignPullRequest(prFailureNumber, prUsers)
        } else {
            console.log('Authors could not be found. PR will not be assigned.')
        }
        return false
    }
    return true
    // } catch (error) {
    //     console.error('Error checking PR mergeability:', error)
    // }
}

async function isPullRequestReadyToMerge(pullNumber) {
    // try {
    // Get pull request information
    const prResponse = await githubAxios.get(
        `/repos/${OWNER_REPO}/pulls/${pullNumber}`
    )
    const prData = prResponse.data

    // Check if the PR is mergeable and not a draft
    if (
        prData.draft ||
        prData.mergeable_state !== 'clean' ||
        !prData.mergeable
    ) {
        console.log(
            'Pull request is not ready to merge (Draft/Merge conflicts/Checks not passed)'
        )
        return false
    }

    // Get reviews for the pull request
    const reviewsResponse = await githubAxios.get(
        `/${OWNER_REPO}/pulls/${pullNumber}/reviews`
    )
    const reviewsData = reviewsResponse.data

    // Check for at least one approved review and no changes requested
    const changesRequested = reviewsData.some(
        (review) => review.state === 'CHANGES_REQUESTED'
    )
    const approved = reviewsData.some((review) => review.state === 'APPROVED')

    if (changesRequested || !approved) {
        console.log('Pull request does not have the necessary reviews')
        return false
    }

    // Get the combined status for the head commit of the PR
    const statusResponse = await githubAxios.get(
        `/${OWNER_REPO}/commits/${prData.head.sha}/status`
    )
    const statusData = statusResponse.data

    // Check for successful status checks
    if (statusData.state !== 'success') {
        console.log('Status checks have not passed')
        return false
    }

    // If all checks above pass, the PR is ready to merge
    console.log('Pull request is ready to merge')
    return true
    // } catch (error) {
    //     handleCatch(
    //         'Error checking if the pull request is ready to merge:',
    //         error
    //     )
    //     throw ('Error checking if the pull request is ready to merge:', error)
    // }
}

async function mergePullRequest(head, base) {
    // try {
    // await isPullRequestReadyToMerge(PULL_REQUEST.number)
    if (await isMergeable(PULL_REQUEST.number, head, base)) {
        const mergeResponse = await githubAxios.put(
            `/repos/${OWNER_REPO}/pulls/${PULL_REQUEST.number}/merge`,
            {
                commit_title: `Automerge PR #${PULL_REQUEST.number}`,
                commit_message: 'Automatically merged by GitHub Actions',
                merge_method: 'merge',
            }
        )
        if (mergeResponse.status === 200) {
            console.log(`Successfully merged PR #${PULL_REQUEST.number}`)
        } else {
            console.error('Failed to merge PR:', mergeResponse.data)
        }
    }
    // } catch (error) {
    //     handleCatch('Error merging pull request:', error)
    //     throw ('Error merging pull request:', error)
    // }
}
const getAutomaticPRConfig = (head, base, onSuccess) => {
    return {
        title: `[${
            onSuccess ? 'AUTOMERGE' : 'AUTOMERGE_FAILED'
        }] [${head} => ${base}] ${PULL_REQUEST.title.split(']').at(-1).trim()}`,
        body: `Triggered by ${onSuccess ? 'successful' : 'failed'} [PR ${
            PULL_REQUEST.number
        }](${PULL_REQUEST.html_url}) merge. Authored by ${
            PULL_REQUEST.user.login
        }`,
    }
}
const getNextBranchForPR = (currentBranch, allBranches) => {
    const branchesArray = allBranches.split(',')
    const currentIndex = branchesArray.indexOf(currentBranch)
    return currentIndex < branchesArray.length - 1
        ? branchesArray[currentIndex + 1]
        : null
}

;(async () => {
    const sourceBranch = PULL_REQUEST ? PULL_REQUEST.head.ref : null
    const labels = PULL_REQUEST
        ? PULL_REQUEST.labels.map((label) => label.name)
        : []
    if (labels.includes(AUTOMERGE_LABEL)) {
        const prMergeResult = await mergePullRequest(
            PULL_REQUEST.head.ref,
            PULL_REQUEST.base.ref
        )
        const nextBranch = getNextBranchForPR(
            PULL_REQUEST.base.ref,
            AUTOMERGE_BRANCHES
        )
        // If you want to delete the branch after merging
        ;('Pull request was created ')

        if (nextBranch === null) {
            await deleteBranch(sourceBranch)
        } else {
            await createPullRequest(nextBranch, sourceBranch, true, [
                AUTOMERGE_LABEL,
            ])
        }
    } else {
        console.log('PR does not have the automerge label. Skipping action.')
    }
})()
