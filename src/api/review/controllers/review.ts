import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::review.review', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    
    // Ensure we only find reviews for this user
    ctx.query.filters = {
      ...(ctx.query.filters as any),
      user: { id: user.id },
    };
    
    return await super.find(ctx);
  },

  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { id } = ctx.params;
    const entity = await strapi.db.query('api::review.review').findOne({
      where: { id, user: { id: user.id } },
    });
    
    if (!entity) return ctx.notFound('Review not found');
    
    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  async analyzeRepo(ctx) {
    try {
      const { owner, repo } = ctx.request.body;
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in to analyze a repository');
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

      const systemPrompt = 'You are an expert code reviewer. Analyze the provided codebase files and generate a comprehensive markdown review. Include sections for: Architecture Overview, Code Quality, Security Vulnerabilities, and Recommended Improvements. Be concise but thorough.';
      
      const initialMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'assistant', content: 'Analyzing repository...' }
      ];

      const reviewRecord = await strapi.db.query('api::review.review').create({
        data: {
          user: user.id,
          repositoryName: repo,
          repositoryOwner: owner,
          status: 'pending',
          messages: initialMessages,
        },
      });

      try {
        // Get default branch dynamically
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });
        
        if (!repoRes.ok) {
           throw new Error('Failed to fetch repository info');
        }
        
        const repoInfo = (await repoRes.json()) as any;
        const defaultBranch = repoInfo.default_branch || 'main';

        const treeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, {
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });

        if (!treeResponse.ok) {
           throw new Error(`Failed to fetch repository tree for branch ${defaultBranch}`);
        }

        const treeData = (await treeResponse.json()) as any;
        const allowedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.md'];
        const excludedPaths = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor'];

        let files = treeData.tree.filter((item: any) => {
          if (item.type !== 'blob') return false;
          const pathParts = item.path.split('/');
          if (pathParts.some((part: string) => excludedPaths.includes(part))) return false;
          const ext = item.path.substring(item.path.lastIndexOf('.'));
          if (!allowedExtensions.includes(ext)) return false;
          return true;
        });

        files = files.slice(0, 10);

        let codebaseContent = '';
        for (const file of files) {
          const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
            headers: {
              Authorization: `Bearer ${connection.accessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });
          if (fileRes.ok) {
             const fileData = (await fileRes.json()) as any;
             if (fileData.content && fileData.encoding === 'base64' && fileData.size < 50000) {
               const content = Buffer.from(fileData.content, 'base64').toString('utf8');
               codebaseContent += `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${content}\n\`\`\`\n`;
             }
          }
        }

        if (!codebaseContent) {
           throw new Error('No readable source code files found in the repository.');
        }

        const userPrompt = `Please review the following repository files:\n\n${codebaseContent}`;
        
        const apiMessages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
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
            messages: apiMessages,
            max_tokens: 2048,
            temperature: 0.15,
            top_p: 1.00,
            frequency_penalty: 0.00,
            presence_penalty: 0.00,
            stream: false
          })
        });

        if (!mistralResponse.ok) {
           const errData = (await mistralResponse.json()) as any;
           throw new Error(`Mistral API Error: ${errData.message || 'Unknown error'}`);
        }

        const mistralData = (await mistralResponse.json()) as any;
        const aiMessage = mistralData.choices[0].message;

        apiMessages.push(aiMessage);

        const updatedReview = await strapi.db.query('api::review.review').update({
          where: { id: reviewRecord.id },
          data: {
            status: 'completed',
            messages: apiMessages,
          },
        });

        return updatedReview;

      } catch (innerError: any) {
        await strapi.db.query('api::review.review').update({
          where: { id: reviewRecord.id },
          data: {
            status: 'failed',
            messages: [...initialMessages, { role: 'assistant', content: innerError.message || 'Analysis failed' }],
          },
        });
        return ctx.badRequest(innerError.message || 'Analysis failed');
      }
    } catch (error) {
      strapi.log.error('analyzeRepo error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async chat(ctx) {
    try {
      const { reviewId, message } = ctx.request.body;
      const user = ctx.state.user;

      if (!user) return ctx.unauthorized();
      if (!reviewId || !message) return ctx.badRequest('Missing reviewId or message');

      const review = await strapi.db.query('api::review.review').findOne({
        where: { id: reviewId, user: user.id },
      });

      if (!review) return ctx.notFound('Review not found');

      const messages = [...(review.messages || [])];
      messages.push({ role: 'user', content: message });

      const mistralResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer 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'
        },
        body: JSON.stringify({
          model: 'mistralai/mistral-large-3-675b-instruct-2512',
          messages: messages,
          max_tokens: 2048,
          temperature: 0.15,
          top_p: 1.00,
          frequency_penalty: 0.00,
          presence_penalty: 0.00,
          stream: false
        })
      });

      if (!mistralResponse.ok) {
         return ctx.badRequest('Mistral API failed');
      }

      const mistralData = (await mistralResponse.json()) as any;
      const aiMessage = mistralData.choices[0].message;

      messages.push(aiMessage);

      const updatedReview = await strapi.db.query('api::review.review').update({
        where: { id: reviewId },
        data: { messages },
      });

      return updatedReview;
    } catch (error) {
      strapi.log.error('chat error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async applyFixes(ctx) {
    try {
      const { reviewId } = ctx.request.body;
      const user = ctx.state.user;

      if (!user) return ctx.unauthorized();

      const review = await strapi.db.query('api::review.review').findOne({
        where: { id: reviewId, user: user.id },
      });

      if (!review) return ctx.notFound('Review not found');

      const connection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (!connection || !connection.accessToken) {
        return ctx.unauthorized('GitHub account not connected');
      }

      const owner = review.repositoryOwner;
      const repo = review.repositoryName;
      console.log(`[applyFixes] Initiating patch generation for ${owner}/${repo}`);
      
      const patchMessages = [...(review.messages || [])];
      patchMessages.push({
        role: 'user', 
        content: 'Based on our entire conversation above, output ONLY a JSON array of the specific file modifications needed. Do NOT rewrite files that do not need changes. The JSON must exactly follow this format:\n[{"path": "exact_filename.ts", "content": "full updated file content here..."}]\nOutput raw JSON only. Keep it as short as possible while applying the necessary fixes.'
      });

      const mistralResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer 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'
        },
        body: JSON.stringify({
          model: 'mistralai/mistral-large-3-675b-instruct-2512',
          messages: patchMessages,
          max_tokens: 4000,
          temperature: 0.1,
          stream: false
        })
      });

      console.log(`[applyFixes] NVIDIA API status: ${mistralResponse.status}`);
      if (!mistralResponse.ok) return ctx.badRequest('Mistral API failed to generate patch');
      
      const mistralData = (await mistralResponse.json()) as any;
      let rawJson = mistralData.choices[0].message.content.trim();
      
      if (rawJson.startsWith('```json')) {
         rawJson = rawJson.replace(/```json\n?/, '').replace(/```$/, '').trim();
      } else if (rawJson.startsWith('```')) {
         rawJson = rawJson.replace(/```\n?/, '').replace(/```$/, '').trim();
      }

      let changes = [];
      try {
        changes = JSON.parse(rawJson);
      } catch (e) {
        return ctx.badRequest('Failed to parse AI generated patch JSON.');
      }

      if (!Array.isArray(changes) || changes.length === 0) {
        return ctx.badRequest('No valid changes found.');
      }

      console.log(`[applyFixes] Found ${changes.length} changes. Communicating with GitHub...`);

      const githubHeaders = {
        Authorization: `Bearer ${connection.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: githubHeaders });
      if (!repoRes.ok) return ctx.badRequest('Failed to fetch repo info from GitHub');
      const repoInfo = (await repoRes.json()) as any;
      const defaultBranch = repoInfo.default_branch;

      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`, { headers: githubHeaders });
      if (!refRes.ok) return ctx.badRequest('Failed to fetch base ref from GitHub');
      const refData = (await refRes.json()) as any;
      const baseCommitSha = refData.object.sha;

      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, { headers: githubHeaders });
      if (!commitRes.ok) return ctx.badRequest('Failed to fetch base commit from GitHub');
      const commitData = (await commitRes.json()) as any;
      const baseTreeSha = commitData.tree.sha;

      const treeItems = [];
      for (const change of changes) {
         if (!change.path || !change.content) continue;
         const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
           method: 'POST',
           headers: githubHeaders,
           body: JSON.stringify({ content: change.content, encoding: 'utf-8' })
         });
         if (!blobRes.ok) return ctx.badRequest(`Failed to create blob for ${change.path}`);
         const blobData = (await blobRes.json()) as any;
         treeItems.push({
           path: change.path,
           mode: '100644',
           type: 'blob',
           sha: blobData.sha
         });
      }

      const newTreeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
      });
      if (!newTreeRes.ok) return ctx.badRequest('Failed to create tree on GitHub');
      const newTreeData = (await newTreeRes.json()) as any;

      const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          message: 'Apply AI generated code review fixes',
          tree: newTreeData.sha,
          parents: [baseCommitSha]
        })
      });
      if (!newCommitRes.ok) return ctx.badRequest('Failed to create commit on GitHub');
      const newCommitData = (await newCommitRes.json()) as any;

      const branchName = `codescan-fixes-${Date.now()}`;
      const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: newCommitData.sha
        })
      });
      if (!createRefRes.ok) return ctx.badRequest('Failed to create branch on GitHub');

      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          title: 'AI Code Review Fixes',
          body: 'This PR was automatically generated by the AI Code Review tool.',
          head: branchName,
          base: defaultBranch
        })
      });
      if (!prRes.ok) return ctx.badRequest('Failed to create Pull Request on GitHub');
      
      const prData = (await prRes.json()) as any;

      // Save the PR URL back to the review record
      await strapi.db.query('api::review.review').update({
        where: { id: reviewId },
        data: { prUrl: prData.html_url },
      });

      console.log(`[applyFixes] Success! PR created: ${prData.html_url}`);
      return { success: true, prUrl: prData.html_url };
    } catch (error: any) {
      console.error('[applyFixes] Error:', error);
      strapi.log.error('applyFixes error', error);
      return ctx.badRequest(error.message || 'Internal server error while applying fixes');
    }
  }
}));
