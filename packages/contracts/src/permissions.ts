/** RBAC permission catalogue (ADR-018). Deny by default: anything not granted is forbidden. */
export const PERMISSIONS = {
  viewProduction: 'monitoring.production.view',
  viewUtilization: 'monitoring.utilization.view',
  viewStopTime: 'monitoring.stoptime.view',
  viewMachineDetail: 'analysis.machinedetail.view',
  viewSales: 'monitoring.sales.view',
  viewScrap: 'monitoring.scrap.view',
  exportProduction: 'export.production',
  exportUtilization: 'export.utilization',
  exportStopTime: 'export.stoptime',
  exportSales: 'export.sales',
  viewMasterData: 'masterdata.view',
  editMasterData: 'masterdata.edit',
  viewSettings: 'settings.view',
  editSettings: 'settings.edit',
  manageUsers: 'admin.users.manage',
  manageRoles: 'admin.roles.manage',
  viewAudit: 'admin.audit.view',
  manageKiosks: 'admin.kiosks.manage',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'monitoring.production.view': 'Lihat Production',
  'monitoring.utilization.view': 'Lihat Machine Utilization',
  'monitoring.stoptime.view': 'Lihat Stop Time',
  'analysis.machinedetail.view': 'Lihat Machine Detail',
  'monitoring.sales.view': 'Lihat Sales',
  'monitoring.scrap.view': 'Lihat Scrap',
  'export.production': 'Export Production',
  'export.utilization': 'Export Machine Utilization',
  'export.stoptime': 'Export Stop Time',
  'export.sales': 'Export Sales',
  'masterdata.view': 'Lihat Master Data',
  'masterdata.edit': 'Edit Master Data',
  'settings.view': 'Lihat Settings',
  'settings.edit': 'Edit Settings',
  'admin.users.manage': 'Kelola user',
  'admin.roles.manage': 'Kelola role & permission',
  'admin.audit.view': 'Lihat audit log',
  'admin.kiosks.manage': 'Provision / cabut kiosk',
};

const ALL_USERS: Permission[] = [PERMISSIONS.viewProduction, PERMISSIONS.viewUtilization, PERMISSIONS.viewStopTime, PERMISSIONS.viewMachineDetail, PERMISSIONS.viewSettings];
/** Default matrix (STATE §8). Super admin is the only role with role/permission, settings edit and audit. */
export const DEFAULT_ROLE_PERMISSIONS = {
  superAdmin: ALL_PERMISSIONS,
  admin: [
    ...ALL_USERS,
    PERMISSIONS.viewSales, PERMISSIONS.viewScrap,
    PERMISSIONS.exportProduction, PERMISSIONS.exportUtilization, PERMISSIONS.exportStopTime, PERMISSIONS.exportSales,
    PERMISSIONS.viewMasterData, PERMISSIONS.editMasterData,
    PERMISSIONS.manageUsers, PERMISSIONS.manageKiosks,
  ],
  user: ALL_USERS,
} satisfies Record<string, Permission[]>;

/** Admin MUST NOT grant beyond own permissions. */
export const isSubset = (wanted: readonly string[], held: readonly string[]): boolean => wanted.every((p) => held.includes(p));
