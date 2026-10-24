// UI hints only. The server still enforces every action; these checks just
// keep buttons for actions a person cannot perform out of the interface.
export function can(holder, permission) {
  if (!holder) return false;
  if (holder.isOwner === true) return true;
  const permissions = holder.permissions;
  return Array.isArray(permissions) && (permissions.includes('*') || permissions.includes(permission));
}
