// SvelteKit 3's events and `Handle`, by shape, as an app
// types them whose `[id=int]` matcher parses the param to a number:
// `@sveltejs/kit` is no dependency of this package.
type Params = { id?: number };

export type RequestEvent = {
  url: URL;
  params: Params;
  route: { id: string | null };
  cookies: { get: (name: string) => string | undefined };
  request: Request;
  locals: Record<string, any>;
};

export type ServerLoadEvent = RequestEvent & { isDataRequest: boolean };

export type LoadEvent = Pick<RequestEvent, 'url' | 'params' | 'route'> & { data: Record<string, any> | null };

type ResolveOptions = { transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined | Promise<string | undefined> };

export type Handle = (input: { event: RequestEvent; resolve: (event: RequestEvent, opts?: ResolveOptions) => Promise<Response> }) => Response | Promise<Response>;
