const webpush = require('web-push');
const { db } = require('./db/conn');

// Cles VAPID fixes (pas de secret financier en jeu) : generees une fois et
// codees en dur pour rester stables meme si la base se reinitialise a chaque
// deploiement (voir database.sqlite git-tracke) - sinon tous les abonnements
// deviendraient invalides a chaque mise a jour de l'appli.
const VAPID_PUBLIC_KEY = 'BF99n45yeqEGX1n4-7gdazKUetw_05YKxqCbUhPt_WTXl7K4GiBXhm8CHMSLg7HNlabMBhr8qq7pA84e-ioAfvY';
const VAPID_PRIVATE_KEY = 'qOn1_MwIVMlCf5GSOcxLLfKKXBTyW3YgKF2uVI4_RF8';

webpush.setVapidDetails('mailto:contact@bordanova.fr', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function getSubscriptionsForUsernames(usernames) {
  return new Promise((resolve, reject) => {
    if (!usernames.length) {
      resolve([]);
      return;
    }

    const placeholders = usernames.map(() => '?').join(',');
    db.all(
      `SELECT * FROM push_subscriptions WHERE username IN (${placeholders})`,
      usernames,
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      },
    );
  });
}

function deleteSubscriptionByEndpoint(endpoint) {
  db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

async function sendPushToUsernames(usernames, payload) {
  const uniqueUsernames = [...new Set(usernames.filter(Boolean))];
  if (!uniqueUsernames.length) {
    return;
  }

  const subs = await getSubscriptionsForUsernames(uniqueUsernames);
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map((sub) =>
      webpush
        .sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        )
        .catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            deleteSubscriptionByEndpoint(sub.endpoint);
          } else {
            console.warn('Push notification failed', err.statusCode, err.body);
          }
        }),
    ),
  );
}

module.exports = { VAPID_PUBLIC_KEY, sendPushToUsernames };
