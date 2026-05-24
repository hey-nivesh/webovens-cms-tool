import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::github-connection.github-connection', ({ strapi }) => ({
  async exchangeCode(ctx) {
    try {
      const { code } = ctx.request.body;
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in to connect GitHub');
      }

      if (!code) {
        return ctx.badRequest('GitHub code is required');
      }

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const tokenData = (await tokenResponse.json()) as any;

      if (tokenData.error) {
        return ctx.badRequest(tokenData.error_description || 'Failed to exchange code');
      }

      const accessToken = tokenData.access_token;
      const scope = tokenData.scope;

      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const userData = (await userResponse.json()) as any;

      if (!userResponse.ok) {
        return ctx.badRequest(userData.message || 'Failed to fetch GitHub user');
      }

      const existingConnection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (existingConnection) {
        await strapi.db.query('api::github-connection.github-connection').update({
          where: { id: existingConnection.id },
          data: {
            accessToken,
            username: userData.login,
            avatarUrl: userData.avatar_url,
            scope,
            connectedAt: new Date(),
          },
        });
      } else {
        await strapi.db.query('api::github-connection.github-connection').create({
          data: {
            user: user.id,
            accessToken,
            username: userData.login,
            avatarUrl: userData.avatar_url,
            scope,
            connectedAt: new Date(),
          },
        });
      }

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          githubAccessToken: accessToken,
          githubUsername: userData.login,
          githubConnected: true,
        },
      });

      return {
        success: true,
        username: userData.login,
        avatarUrl: userData.avatar_url,
      };
    } catch (error) {
      strapi.log.error('GitHub exchange code error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async disconnect(ctx) {
    try {
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in to disconnect GitHub');
      }

      await strapi.db.query('api::github-connection.github-connection').delete({
        where: { user: user.id },
      });

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          githubAccessToken: null,
          githubUsername: null,
          githubConnected: false,
        },
      });

      return { success: true };
    } catch (error) {
      strapi.log.error('GitHub disconnect error', error);
      return ctx.badRequest('Internal server error');
    }
  },
}));
