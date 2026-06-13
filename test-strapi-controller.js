const { createStrapi } = require('@strapi/strapi');

async function test() {
  console.log('Creating Strapi...');
  const app = createStrapi({ distDir: './dist' });
  console.log('Bootstrapping Strapi...');
  await app.bootstrap();
  console.log('Strapi bootstrapped successfully.');

  try {
    // Let's get the first user
    const user = await app.db.query('plugin::users-permissions.user').findOne({});

    if (!user) {
      console.log('No user found in DB');
      await app.destroy();
      return;
    }

    console.log('User found in DB:', user);

    // Now let's try calling find or simulating the controller.
    const controller = app.controller('api::review.review');
    console.log('Controller found.');

    const ctx = {
      state: { user },
      query: {},
      unauthorized() {
        console.log('unauthorized called');
      },
      badRequest(msg) {
        console.log('badRequest called:', msg);
      },
      send(data) {
        console.log('send called with:', data);
      }
    };

    console.log('Executing find...');
    const result = await controller.find(ctx);
    console.log('find result:', result);

  } catch (err) {
    console.error('ERROR OCCURRED:');
    console.error(err);
  } finally {
    await app.destroy();
  }
}

test();
