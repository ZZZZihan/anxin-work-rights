export type RequestUser = {
  userId: string;
  displayName: string;
  email: string;
};

const USER_ID_HEADER = 'oai-authenticated-user-id';
const USER_EMAIL_HEADER = 'oai-authenticated-user-email';
const USER_FULL_NAME_HEADER = 'oai-authenticated-user-full-name';
const USER_FULL_NAME_ENCODING_HEADER = 'oai-authenticated-user-full-name-encoding';

export function getRequestUser(request: Request): RequestUser | null {
  const userId = request.headers.get(USER_ID_HEADER);
  const email = request.headers.get(USER_EMAIL_HEADER);

  if (userId && email) {
    const encodedName = request.headers.get(USER_FULL_NAME_HEADER);
    const fullName =
      encodedName &&
      request.headers.get(USER_FULL_NAME_ENCODING_HEADER) === 'percent-encoded-utf-8'
        ? safeDecode(encodedName)
        : encodedName;

    return {
      userId,
      email,
      displayName: fullName || email.split('@')[0] || '用户',
    };
  }

  // The local preview has no Sites authentication gateway. Production never
  // receives this fallback identity.
  if (process.env.NODE_ENV !== 'production') {
    return {
      userId: 'local-demo-user',
      email: 'demo@local.anxin',
      displayName: '王海涛',
    };
  }

  return null;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function unauthorized() {
  return Response.json(
    { error: '需要登录后才能访问你的案件资料。' },
    { status: 401 },
  );
}
