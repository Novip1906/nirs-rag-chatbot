async function ensureDepartment({ client, syncDeps, syncDepartment }, departmentId) {
  const known = await syncDeps.listDepartments();
  if (known.some((department) => department.directoryId === departmentId)) {
    return true;
  }
  const departments = await client.listDepartments();
  if (!departments.ok) {
    return false;
  }
  const department = departments.value.find((candidate) => candidate.id === departmentId);
  if (department) {
    await syncDepartment(syncDeps, department);
  }
  return true;
}

module.exports = { ensureDepartment };
