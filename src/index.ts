import type { Core } from '@strapi/strapi';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    try {
      // 1. Setup Public Role Permissions
      const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      });
      
      if (publicRole) {
        const publicActions = [
          'plugin::users-permissions.auth.callback',
          'plugin::users-permissions.auth.register',
          'api::github-connection.github-connection.githubAuth',
        ];
        
        for (const action of publicActions) {
          const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
            where: { role: publicRole.id, action }
          });
          if (!existing) {
            await strapi.db.query('plugin::users-permissions.permission').create({
              data: { role: publicRole.id, action }
            });
          }
        }
      }

      // 2. Setup Authenticated Role Permissions
      const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'authenticated' },
      });
      
      if (authRole) {
        const authActions = [
          'plugin::users-permissions.user.me',
          'plugin::users-permissions.user.update',
          'api::github-connection.github-connection.exchangeCode',
          'api::github-connection.github-connection.disconnect',
          'api::github-connection.repos.listRepos',
          'api::github-connection.repos.getRepoTree',
          'api::github-connection.repos.getFileContent',
          'api::review.review.analyzeRepo',
          'api::review.review.chat',
          'api::review.review.applyFixes',
          'api::review.review.find',
          'api::review.review.findOne'
        ];
        
        for (const action of authActions) {
          const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
            where: { role: authRole.id, action }
          });
          if (!existing) {
            await strapi.db.query('plugin::users-permissions.permission').create({
              data: { role: authRole.id, action }
            });
          }
        }
      }

      // 3. Seed Test User
      if (authRole) {
        const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { email: 'test@codescan.ai' },
        });

        if (!existingUser) {
          await strapi.service('plugin::users-permissions.user').add({
            username: 'Test User',
            email: 'test@codescan.ai',
            password: 'TestPass123!',
            confirmed: true,
            role: authRole.id,
            plan: 'free',
            reviewCount: 0,
            githubConnected: false
          });
          strapi.log.info('Seeded test user: test@codescan.ai');
        }
      }
    } catch (error) {
      strapi.log.error('Failed to run bootstrap: ', error);
    }
  },
};
