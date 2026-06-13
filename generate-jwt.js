const { createStrapi } = require('@strapi/strapi');

async function main() {
  const app = createStrapi({ distDir: './dist' });
  await app.bootstrap();

  try {
    const jwtService = app.plugin('users-permissions').service('jwt');
    
    // User with id 2 (Nivesh Jain)
    const token = jwtService.issue({ id: 2 });
    console.log('JWT_TOKEN_USER_2:', token);

  } catch (err) {
    console.error(err);
  } finally {
    await app.destroy();
  }
}

main();
