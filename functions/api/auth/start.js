import { authConfig, buildAuthorizeUrl, json, randomId } from "./_common.js";

export async function onRequestPost({ env }) {
  const config = authConfig(env);
  const loginId = randomId("neocrm-web");
  const startedAt = new Date().toISOString();
  await env.SALES_DATA.put(
    `auth-login:${loginId}`,
    JSON.stringify({ loginId, startedAt }),
    { expirationTtl: 60 * 10 }
  );

  return json({
    loginId,
    authorizeUrl: buildAuthorizeUrl(config, loginId)
  });
}
