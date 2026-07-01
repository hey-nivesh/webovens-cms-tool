import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::review.review', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    
    // Query reviews directly using strapi.db.query to bypass REST parser bugs for relation filters
    const reviews = await strapi.db.query('api::review.review').findMany({
      where: { user: user.id },
      orderBy: { createdAt: 'desc' },
    });
    
    const sanitizedEntities = await this.sanitizeOutput(reviews, ctx);
    return this.transformResponse(sanitizedEntities);
  },

  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { id } = ctx.params;
    const entity = await strapi.db.query('api::review.review').findOne({
      where: { id, user: user.id },
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
            model: 'meta/llama-3.3-70b-instruct',
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
          model: 'meta/llama-3.3-70b-instruct',
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
      
      // ── SINGLE-CALL PATCH APPROACH ───────────────────────────────────────────
      // Instead of generating full file rewrites (huge output, rate-limited),
      // ask the AI for compact surgical find/replace operations.
      // We then fetch each file from GitHub, apply patches in memory, and commit.
      // Total: 1 AI call, output fits in ~3k tokens.
      // ─────────────────────────────────────────────────────────────────────────
      const patchPrompt = `Based on our entire code review conversation above, output a JSON array of surgical find/replace patches for the files that need fixes.

STRICT FORMAT — output ONLY this JSON, no markdown, no explanation:
[
  {
    "file": "relative/path/to/file.py",
    "patches": [
      {
        "find": "exact_original_code_to_replace",
        "replace": "new_fixed_code"
      }
    ]
  }
]

Rules:
- "find" must be the EXACT text currently in the file (copy-paste accuracy — whitespace matters).
- "replace" is the corrected version of that exact block.
- Keep patches small and focused — only the lines that actually change.
- Multiple patches per file are fine.
- If a file needs no changes, omit it entirely.
- Output raw JSON only. No markdown fences. No extra text.`;

      const patchMessages = [...(review.messages || [])];
      patchMessages.push({ role: 'user', content: patchPrompt });

      console.log('[applyFixes] Requesting single-call patch JSON from AI...');
      const patchResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer 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'
        },
        body: JSON.stringify({
          model: 'meta/llama-3.3-70b-instruct',
          messages: patchMessages,
          max_tokens: 4096,
          temperature: 0.1,
          stream: false
        })
      });

      console.log(`[applyFixes] Patch API status: ${patchResponse.status}`);
      if (!patchResponse.ok) {
        const errText = await patchResponse.text();
        console.error(`[applyFixes] Patch generation failed (${patchResponse.status}): ${errText}`);
        return ctx.badRequest(`AI patch generation failed: ${patchResponse.status}`);
      }

      const patchData = (await patchResponse.json()) as any;
      let rawPatch = patchData.choices[0].message.content.trim();
      console.log('[applyFixes] Raw patch response (first 300 chars):', rawPatch.substring(0, 300));

      // Strip markdown fences if present
      rawPatch = rawPatch.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

      // Extract JSON array
      const arrStart = rawPatch.indexOf('[');
      const arrEnd = rawPatch.lastIndexOf(']');
      if (arrStart === -1 || arrEnd === -1) {
        console.error('[applyFixes] No JSON array found in patch response:', rawPatch);
        return ctx.badRequest('AI did not return a valid patch array.');
      }
      rawPatch = rawPatch.substring(arrStart, arrEnd + 1);

      let filePatchList: Array<{ file: string; patches: Array<{ find: string; replace: string }> }> = [];
      try {
        filePatchList = JSON.parse(rawPatch);
      } catch (e) {
        console.error('[applyFixes] Failed to parse patch JSON:', rawPatch.substring(0, 500));
        return ctx.badRequest('Failed to parse AI patch JSON.');
      }

      if (!Array.isArray(filePatchList) || filePatchList.length === 0) {
        return ctx.send({ success: true, message: 'AI found no changes required.' });
      }

      console.log(`[applyFixes] Got patches for ${filePatchList.length} file(s):`, filePatchList.map(f => f.file));

      // ── Fetch each file from GitHub, apply patches, build changes_to_apply ───
      const githubHeaders = {
        Authorization: `Bearer ${connection.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'AntiGravity-AI'
      };

      const changes_to_apply: Array<{ path: string; content: string }> = [];

      for (const filePatch of filePatchList) {
        const filePath = filePatch.file;
        if (!filePath || !Array.isArray(filePatch.patches) || filePatch.patches.length === 0) continue;

        // Fetch current file content from GitHub
        const ghFileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
          headers: githubHeaders
        });

        if (!ghFileRes.ok) {
          console.warn(`[applyFixes] Could not fetch ${filePath} from GitHub (${ghFileRes.status}) — skipping`);
          continue;
        }

        const ghFileData = (await ghFileRes.json()) as any;
        if (!ghFileData.content || ghFileData.encoding !== 'base64') {
          console.warn(`[applyFixes] ${filePath} has no base64 content — skipping`);
          continue;
        }

        let fileContent = Buffer.from(ghFileData.content.replace(/\s+/g, ''), 'base64').toString('utf8');
        let patchApplied = 0;

        for (const patch of filePatch.patches) {
          if (!patch.find || patch.replace === undefined) continue;
          if (fileContent.includes(patch.find)) {
            fileContent = fileContent.replace(patch.find, patch.replace);
            patchApplied++;
          } else {
            console.warn(`[applyFixes] Patch find-text not found in ${filePath}:`, patch.find.substring(0, 80));
          }
        }

        if (patchApplied > 0) {
          console.log(`[applyFixes] ✓ Applied ${patchApplied}/${filePatch.patches.length} patch(es) to ${filePath}`);
          changes_to_apply.push({ path: filePath, content: fileContent });
        } else {
          console.warn(`[applyFixes] ✗ No patches matched in ${filePath} — skipping`);
        }
      }

      if (changes_to_apply.length === 0) {
        return ctx.badRequest('No patch find-text matched in any file. The AI patches may be stale or incorrect.');
      }

      console.log(`[applyFixes] Ready to commit ${changes_to_apply.length} patched file(s) to GitHub.`);

      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: githubHeaders });

      if (!repoRes.ok) {
        const errText = await repoRes.text();
        console.error(`[applyFixes] Failed to fetch repo info. Status: ${repoRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to fetch repo info from GitHub: ${errText}`);
      }
      const repoInfo = (await repoRes.json()) as any;
      const defaultBranch = repoInfo.default_branch;

      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`, { headers: githubHeaders });
      if (!refRes.ok) {
        const errText = await refRes.text();
        console.error(`[applyFixes] Failed to fetch base ref. Status: ${refRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to fetch base ref from GitHub: ${errText}`);
      }
      const refData = (await refRes.json()) as any;
      const baseCommitSha = refData.object.sha;

      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, { headers: githubHeaders });
      if (!commitRes.ok) {
        const errText = await commitRes.text();
        console.error(`[applyFixes] Failed to fetch base commit. Status: ${commitRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to fetch base commit from GitHub: ${errText}`);
      }
      const commitData = (await commitRes.json()) as any;
      const baseTreeSha = commitData.tree.sha;

      const branchName = `feature/code-review-fixes-${Date.now()}`;
      console.log(`[applyFixes] Creating new branch ${branchName} originating from default branch ${defaultBranch} (commit ${baseCommitSha})`);
      const createBranchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseCommitSha
        })
      });
      if (!createBranchRes.ok) {
        const errText = await createBranchRes.text();
        console.error(`[applyFixes] Failed to create branch ref. Status: ${createBranchRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to create branch on GitHub: ${errText}`);
      }

      const treeItems = [];
      for (const change of changes_to_apply) {
         if (!change.path || !change.content) continue;
         console.log(`[applyFixes] Creating blob for: ${change.path}`);
         // Always send content as base64 to GitHub — this is the safest encoding
         // and avoids any issues with special characters in the file content.
         const base64Content = Buffer.from(change.content, 'utf8').toString('base64');
         const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
           method: 'POST',
           headers: githubHeaders,
           body: JSON.stringify({ content: base64Content, encoding: 'base64' })
         });
         if (!blobRes.ok) {
           const errText = await blobRes.text();
           console.error(`[applyFixes] Failed to create blob for ${change.path}. Status: ${blobRes.status}, Body: ${errText}`);
           return ctx.badRequest(`Failed to create blob for ${change.path}: ${errText}`);
         }
         const blobData = (await blobRes.json()) as any;
         console.log(`[applyFixes] Blob created for ${change.path}: ${blobData.sha}`);
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
      if (!newTreeRes.ok) {
        const errText = await newTreeRes.text();
        console.error(`[applyFixes] Failed to create tree. Status: ${newTreeRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to create tree on GitHub: ${errText}`);
      }
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
      if (!newCommitRes.ok) {
        const errText = await newCommitRes.text();
        console.error(`[applyFixes] Failed to create commit. Status: ${newCommitRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to create commit on GitHub: ${errText}`);
      }
      const newCommitData = (await newCommitRes.json()) as any;

      console.log(`[applyFixes] Updating branch ref for ${branchName} to commit ${newCommitData.sha}`);
      const updateBranchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
        method: 'PATCH',
        headers: githubHeaders,
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false
        })
      });
      if (!updateBranchRes.ok) {
        const errText = await updateBranchRes.text();
        console.error(`[applyFixes] Failed to update branch ref. Status: ${updateBranchRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to update branch reference on GitHub: ${errText}`);
      }

      // Extract the code review summary from the review record messages
      let prBody = 'This PR was automatically generated by the AI Code Review tool.';
      if (review.messages && Array.isArray(review.messages)) {
        const reviewMessage = review.messages.find((m: any) => 
          m.role === 'assistant' && 
          m.content && 
          (m.content.includes('Architecture Overview') || m.content.includes('Recommended Improvements') || m.content.includes('Code Quality'))
        );
        if (reviewMessage) {
          prBody = reviewMessage.content;
        } else {
          const fallback = review.messages.find((m: any) => 
            m.role === 'assistant' && 
            m.content && 
            !m.content.includes('Analyzing repository') &&
            !m.content.includes('Applying fixes')
          );
          if (fallback) {
            prBody = fallback.content;
          }
        }
      }

      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          title: 'AI Code Review Fixes',
          body: prBody,
          head: branchName,
          base: defaultBranch
        })
      });
      if (!prRes.ok) {
        const errText = await prRes.text();
        console.error(`[applyFixes] Failed to create Pull Request. Status: ${prRes.status}, Body: ${errText}`);
        return ctx.badRequest(`Failed to create Pull Request on GitHub: ${errText}`);
      }
      
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
