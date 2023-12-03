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
        Accept: 'application/json',
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

const getAutomaticPRConfig = (head, base, author, failedBranch = undefined) => {
    let title = PULL_REQUEST.title
    let body = PULL_REQUEST.body
    if (PULL_REQUEST.title.includes('[AUTOMERGE]')) {
        const regexTitle = /\[automerge[^\]]*\]\s*\[[^\]]+]\s*\[[^\]]+]\s*(.+)/
        const matchTitle = regexTitle.exec(PULL_REQUEST.title)
        const regexBody = /.+Authored\s+by\s+(\w+)\s+([\s\S]*)/
        const matchBody = regexBody.exec(PULL_REQUEST.body)
        title = matchTitle[1]
        body = matchBody[2]
    }
    return {
        title: `[automerge][${head} -> ${
            failedBranch ? base : ''
        }][${Math.floor(Date.now() / 60000)}]${
            failedBranch ? ' FAILED ' : ''
        } ${title}`,
        body: `Triggered by [PR ${PULL_REQUEST.number}](${PULL_REQUEST.html_url}) merge. Authored by ${author}\n\n${body}`,
    }
}

async function createPR(base, head, author, failedBranch = undefined) {
    return await axios.post(
        `https://api.github.com/repos/${OWNER_REPO}/pulls`,
        {
            ...getAutomaticPRConfig(head, base, author, failedBranch),
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
}
async function createPullRequest(base, head) {
    let author = PULL_REQUEST.user.login
    if (PULL_REQUEST.title.includes('AUTOMERGE')) {
        const regex = /.+Authored\s+by\s+(\w+)\s+([\s\S]*)/
        const match = regex.exec(PULL_REQUEST.body)
        author = match[1]
    }
    const response = await createPR(base, head, author, true)
    // console.log(`response: ${response.data.number}`)
    const prNumber = response.data.number

    await githubAxios.post(`/repos/${OWNER_REPO}/issues/${prNumber}/labels`, {
        labels: [AUTOMERGE_LABEL],
    })

    await new Promise((resolve) => setTimeout(resolve, 5000))
    console.log('Pull request created:', response.data.html_url)

    const pr = await githubAxios.get(`/repos/${OWNER_REPO}/pulls/${prNumber}`)

    // if conflicts then we close created PR and open a new one
    // with original feature branch merging into a new branch created from target branch
    // in order ro resolve conflicts
    if (pr.data.mergeable === false || pr.data.mergeable_state === 'dirty') {
        console.log(`PR ${prNumber} has merge conflicts`)
        const newBranchName = `conflict-resolution-${author}-${base}-${head}-${Math.floor(
            Date.now() / 60000
        )}`
        await createBranchFrom(base, newBranchName)
        const responseOnFailure = await createPR(
            newBranchName,
            head,
            author,
            false,
            base
        )
        const prOnFailureNum = responseOnFailure.data.number
        await closePullRequest(prNumber)
        const authors = (await getPullRequestUsers(PULL_REQUEST.number))
            .concat([author])
            .filter((v, i, arr) => i !== arr.indexOf(v))
        if (authors.length > 0) {
            await assignPullRequest(prOnFailureNum, authors)
        } else {
            console.log('Authors could not be found. PR will not be assigned.')
        }
        return prOnFailureNum
    }
    return prNumber

    // await isMergeable(head, base)
    // return prNumber
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

const getPullRequestUsers = async (prNumber) => {
    // try {
    // Get the latest commit on the head branch
    const commitsResponse = await githubAxios.get(
        `/repos/${OWNER_REPO}/pulls/${prNumber}/commits`
    )
    // Extract the author's GitHub username
    const authors = commitsResponse.data.map((commit) => commit.author.login)
    console.log(`authors: ${authors}`)

    return authors
    // } catch (error) {
    //     console.error('Error retrieving PR author:', error)
    // return null
    // }
}

const assignPullRequest = async (prOnFailureNum, assignees) => {
    // try {
    await githubAxios.post(
        `/repos/${OWNER_REPO}/issues/${prOnFailureNum}/assignees`,
        { assignees: assignees }
    )
    console.log(`PR #${prOnFailureNum} assigned to ${assignees}`)
    // } catch (error) {
    console.error(`Error assigning PR #${prOnFailureNum} to ${assignees}:`)
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

// const isMergeable = async (head, base) => {
//     // try {
//     // Wait for GitHub to calculate mergeability
//     const pr = await githubAxios.get(`/repos/${OWNER_REPO}/pulls/${prNumber}`)
//     if (pr.data.mergeable === false || pr.data.mergeable_state === 'dirty') {
//         console.log(`PR ${PULL_REQUEST.number} has merge conflicts`)
//         const newBranchName = `conflict-resolution-${base}-${Date.now()}`
//         await createBranchFrom(base, newBranchName)

//         const prOnFailureNum = await createPullRequest(
//             newBranchName,
//             head,
//             false
//         )
//         await closePullRequest(PULL_REQUEST.number)
//         const prUsers = await getPullRequestUsers(PULL_REQUEST.head.sha)
//         if (authors.length > 0) {
//             await assignPullRequest(prOnFailureNum, prUsers)
//         } else {
//             console.log('Authors could not be found. PR will not be assigned.')
//         }
//         return false
//     }
//     return true
//     // } catch (error) {
//     //     console.error('Error checking PR mergeability:', error)
//     // }
// }

async function isPullRequestReadyToMerge(pullNumber) {
    return true
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

async function mergePullRequest() {
    // try {
    // await isPullRequestReadyToMerge(PULL_REQUEST.number)
    if (await isPullRequestReadyToMerge(PULL_REQUEST.number)) {
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
        return mergeResponse
    }
    return null
    // } catch (error) {
    //     handleCatch('Error merging pull request:', error)
    //     throw ('Error merging pull request:', error)
    // }
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
        const prMergeResult = await mergePullRequest()
        if (prMergeResult) {
            const nextBranch = getNextBranchForPR(
                PULL_REQUEST.base.ref,
                AUTOMERGE_BRANCHES
            )
            // If you want to delete the branch after merging
            ;('Pull request was created ')

            if (nextBranch === null) {
                await deleteBranch(sourceBranch)
            } else {
                const pullRequest = await createPullRequest(
                    nextBranch,
                    sourceBranch
                )
            }
        }
    } else {
        console.log('PR does not have the automerge label. Skipping action.')
    }
})()
