const axios = require('axios')

const OWNER_REPO = 'mtuktarov/gha'
const createBranchFrom = async (branchName, newBranchName) => {
    const githubAxios = axios.create({
        baseURL: 'https://api.github.com/',
        headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
        },
    })

    const branchRef = `refs/heads/${branchName}`

    try {
        // Get the commit SHA of the existing branch
        const branchData = await githubAxios.get(
            `/repos/${OWNER_REPO}/git/${branchRef}`
        )
        const sha = branchData.data.object.sha

        // Create a new branch reference pointing to the same commit SHA
        await githubAxios.post(`/repos/${OWNER_REPO}/git/refs`, {
            ref: `refs/heads/${newBranchName}`,
            sha: sha,
        })

        console.log(`Branch created: ${newBranchName}`)

        // Get the tree SHA using the commit SHA
        const commitData = await githubAxios.get(
            `/repos/${OWNER_REPO}/git/commits/${sha}`
        )
        const treeSha = commitData.data.tree.sha

        // Create a new commit using the tree SHA
        const newCommitData = await githubAxios.post(
            `/repos/${OWNER_REPO}/git/commits`,
            {
                message: 'This is an empty commit',
                tree: treeSha,
                parents: [sha],
            }
        )

        // Update the branch to point to the new commit
        await githubAxios.patch(
            `/repos/${OWNER_REPO}/git/refs/heads/${newBranchName}`,
            {
                sha: newCommitData.data.sha,
            }
        )

        console.log(
            `Empty commit created on the new branch: ${newCommitData.data.sha}`
        )
    } catch (error) {
        console.error(`Error: ${error.message}`)
        console.log('Request Config:', error.config)
        if (error.response) {
            console.log('Error Response:', error.response.data)
        }
    }
}

;(async () => {
    try {
        await createBranchFrom('master', 'ololo')
    } catch (error) {
        console.error('Error creating the branch with an empty commit:', error)
    }
})()
