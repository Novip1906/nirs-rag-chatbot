export function composeFullName(
  firstName: string | undefined,
  lastName: string | undefined,
  fallback: string,
): string {
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  if (firstName) {
    return firstName;
  }
  if (lastName) {
    return lastName;
  }
  return fallback;
}
