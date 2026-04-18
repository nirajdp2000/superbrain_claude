import { handleNetlifyRequest } from "../../src/netlify-handler.mjs";

export default async (request, context) => handleNetlifyRequest(request, context);

export const config = {
  path: ["/api/*", "/upstox/*"],
};
