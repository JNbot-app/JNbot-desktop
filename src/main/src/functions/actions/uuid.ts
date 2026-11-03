import https from 'https';

async function uuid(username: string): Promise<string | null> {
  return new Promise((resolve) => {
    const fail = (err: unknown) => {
      console.error(err);
      resolve(null);
    };

    try {
      const request = https.get(
        {
          hostname: 'api.mojang.com',
          path: `/users/profiles/minecraft/${username}`,
        },
        (res) => {
          res.setEncoding('utf8');
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if (!body) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(body).id ?? null);
            } catch (err) {
              fail(err);
            }
          });
        },
      );
      request.on('error', fail);
    } catch (err) {
      fail(err);
    }
  });
}

export default uuid;
