export function fullName(person: { first_name: string; last_name: string }): string {
  return [person.first_name, person.last_name]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
}
