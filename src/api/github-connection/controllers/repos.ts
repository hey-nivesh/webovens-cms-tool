export default {
  async listRepos(ctx) {
    try {
      const user = ctx.state.user;
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      const connection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (!connection || !connection.accessToken) {
        return ctx.unauthorized('GitHub account not connected');
      }

      const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&type=all', {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const data = (await response.json()) as any;

      if (!response.ok) {
        if (response.status === 401) {
          return ctx.unauthorized('GitHub token expired or invalid');
        }
        if (response.status === 403) {
          return ctx.tooManyRequests('GitHub rate limit reached, try again in 60 seconds');
        }
        return ctx.badRequest(data.message || 'Failed to fetch repositories');
      }

      const repos = data.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        language: repo.language,
        updated_at: repo.updated_at,
        default_branch: repo.default_branch,
        description: repo.description,
      }));

      return repos;
    } catch (error) {
      strapi.log.error('GitHub listRepos error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async getRepoTree(ctx) {
    try {
      const { owner, repo, branch = 'main' } = ctx.request.query;
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      if (!owner || !repo) {
        return ctx.badRequest('Owner and repo are required');
      }

      const connection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (!connection || !connection.accessToken) {
        return ctx.unauthorized('GitHub account not connected');
      }

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const data = (await response.json()) as any;

      if (!response.ok) {
        if (response.status === 401) {
          return ctx.unauthorized('GitHub token expired or invalid');
        }
        if (response.status === 403) {
          return ctx.tooManyRequests('GitHub rate limit reached, try again in 60 seconds');
        }
        return ctx.badRequest(data.message || 'Failed to fetch repository tree');
      }

      const allowedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.cs', '.php', '.rb'];
      const excludedPaths = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor'];

      const tree = data.tree.filter((item: any) => {
        if (item.type !== 'blob') return false;

        const pathParts = item.path.split('/');
        if (pathParts.some((part: string) => excludedPaths.includes(part))) {
          return false;
        }

        const ext = item.path.substring(item.path.lastIndexOf('.'));
        if (!allowedExtensions.includes(ext)) {
          return false;
        }

        return true;
      });

      return tree;
    } catch (error) {
      strapi.log.error('GitHub getRepoTree error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async getFileContent(ctx) {
    try {
      const { owner, repo, path } = ctx.request.query;
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      if (!owner || !repo || !path) {
        return ctx.badRequest('Owner, repo, and path are required');
      }

      const connection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (!connection || !connection.accessToken) {
        return ctx.unauthorized('GitHub account not connected');
      }

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const data = (await response.json()) as any;

      if (!response.ok) {
        if (response.status === 401) {
          return ctx.unauthorized('GitHub token expired or invalid');
        }
        if (response.status === 403) {
          return ctx.tooManyRequests('GitHub rate limit reached, try again in 60 seconds');
        }
        return ctx.badRequest(data.message || 'Failed to fetch file content');
      }

      if (data.size > 102400) {
        return ctx.badRequest('File size exceeds 100KB limit. Please select a smaller file.');
      }

      let content = '';
      if (data.content && data.encoding === 'base64') {
        content = Buffer.from(data.content, 'base64').toString('utf8');
      }

      return {
        path: data.path,
        content,
        size: data.size,
        sha: data.sha,
      };
    } catch (error) {
      strapi.log.error('GitHub getFileContent error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async analyzeProfile(ctx) {
    try {
      const user = ctx.state.user;
      if (!user) {
        return ctx.unauthorized('You must be logged in');
      }

      const { force = 'false' } = ctx.request.query;

      // 1. Get the connection
      const connection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (!connection || !connection.accessToken) {
        return ctx.unauthorized('GitHub account not connected');
      }

      // 2. Return cached if force is not true
      if (force !== 'true' && connection.profileAnalysis) {
        return connection.profileAnalysis;
      }

      // 3. Fetch GitHub profile data
      const profileRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AntiGravity-AI'
        },
      });

      if (!profileRes.ok) {
        return ctx.badRequest('Failed to fetch GitHub profile');
      }
      const profile = await profileRes.json() as any;

      // Fetch user's repos
      const reposRes = await fetch('https://api.github.com/user/repos?per_page=50&sort=updated', {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AntiGravity-AI'
        },
      });

      let repos = [];
      if (reposRes.ok) {
        repos = await reposRes.json() as any[];
      }

      // 4. Summarize data for the AI
      const repoDetails = repos.slice(0, 15).map((r: any) => ({
        name: r.name,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        size: r.size,
      }));

      const profileDataSummary = {
        login: profile.login,
        name: profile.name,
        bio: profile.bio,
        public_repos: profile.public_repos,
        followers: profile.followers,
        repos: repoDetails,
      };

      // 5. Query Mistral AI via NVIDIA API
      const systemPrompt = `You are a world-class developer profile analyzer.
Analyze the provided GitHub user profile and repository data.
Generate a structured JSON analysis summarizing their profile.
Return ONLY a valid JSON object matching this schema:
{
  "developerPersona": "A creative title describing their developer identity (e.g. 'Systems Architect & Rust Developer', 'Full-Stack Javascript Pioneer', etc.)",
  "profileSummary": "A concise 2-sentence summary highlighting their main interests, style, and tech stack based on repositories and bio.",
  "strengths": [
    "strength 1",
    "strength 2",
    "strength 3"
  ],
  "topLanguages": [
    { "name": "LanguageName", "percentage": 70, "color": "bg-blue-500" },
    { "name": "Language2Name", "percentage": 20, "color": "bg-yellow-500" }
  ],
  "recommendations": [
    "AI-driven suggestion 1",
    "AI-driven suggestion 2",
    "AI-driven suggestion 3"
  ]
}
Ensure the output is pure JSON. Do not wrap it in markdown code blocks (\`\`\`).`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Profile Data:\n${JSON.stringify(profileDataSummary, null, 2)}` }
      ];

      const mistralResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer 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'
        },
        body: JSON.stringify({
          model: 'mistralai/mistral-large-3-675b-instruct-2512',
          messages,
          max_tokens: 1500,
          temperature: 0.2,
        })
      });

      if (!mistralResponse.ok) {
        const errorData = (await mistralResponse.json().catch(() => ({}))) as any;
        throw new Error(`AI API failed: ${errorData.message || 'Unknown error'}`);
      }

      const responseData = await mistralResponse.json() as any;
      let aiText = responseData.choices[0].message.content.trim();

      // Clean markdown code blocks if AI wraps it anyway
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiText = jsonMatch[0];
      }

      let analysis;
      try {
        analysis = JSON.parse(aiText);
      } catch (err) {
        console.error('Failed to parse AI output:', aiText);
        throw new Error('AI returned invalid JSON');
      }

      // 6. Save back to connection
      await strapi.db.query('api::github-connection.github-connection').update({
        where: { id: connection.id },
        data: {
          profileAnalysis: analysis
        }
      });

      return analysis;
    } catch (error: any) {
      strapi.log.error('analyzeProfile error', error);
      return ctx.badRequest(error.message || 'Failed to analyze profile');
    }
  },
};
