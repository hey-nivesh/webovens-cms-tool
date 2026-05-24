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
};
