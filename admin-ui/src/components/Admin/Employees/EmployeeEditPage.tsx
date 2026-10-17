import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  Input,
  Label,
  Switch,
  Tag,
  useToastContext,
} from "@librechat/client";
import { ArrowLeft } from "lucide-react";
import {
  useDeleteDirectoryEmployeeMutation,
  useDirectoryDepartmentsQuery,
  useDirectoryEmployeeQuery,
  useInviteDirectoryEmployeeMutation,
  useResetDirectoryPasswordMutation,
  useRevokeDirectoryInviteMutation,
  useUpdateDirectoryEmployeeMutation,
} from "~/data-provider/Directory";
import { LoadingState } from "~/components/Admin/common/insightsKit";
import { fullName } from "./fullName";
import AdminErrorState from "~/components/Admin/common/AdminErrorState";
import AdminPageHeader from "~/components/Admin/common/AdminPageHeader";
import PageColumns, { PageCard } from "~/components/Admin/common/PageColumns";
import useFreshFormKey from "~/components/Admin/common/useFreshFormKey";
import {
  directoryErrorCode,
  directoryErrorKey,
  directoryFieldErrors,
} from "~/components/Admin/utils/directoryErrors";
import { useAuthContext, useLocalize } from "~/hooks";
import type { TranslationKeys } from "~/hooks/useLocalize";
import { isPendingInvite } from "~/types/directory";
import type {
  DirectoryDepartment,
  DirectoryEmployee,
  DirectoryEmployeeInput,
  DirectoryInvite,
} from "~/types/directory";
import EmployeeProfileFields, { NO_DEPARTMENT } from "./EmployeeForm";
import type { EmployeeProfileValues } from "./EmployeeForm";
import InviteLinkDialog from "./InviteLinkDialog";
import { statusTag } from "./status";
import TemporaryPasswordDialog from "./TemporaryPasswordDialog";

interface SaveError {
  messageKey: TranslationKeys;
  fields: Record<string, TranslationKeys>;
}

function buildChanges(
  employee: DirectoryEmployee,
  profile: EmployeeProfileValues,
  isAdmin: boolean,
  isHead: boolean,
  blocked: boolean,
  pending: boolean,
): DirectoryEmployeeInput {
  const input: DirectoryEmployeeInput = {};
  const firstName = profile.first_name.trim();
  const lastName = profile.last_name.trim();
  const email = profile.email.trim();
  const position = profile.position.trim();
  const departmentId =
    profile.department === NO_DEPARTMENT ? null : profile.department;
  if (firstName !== employee.first_name) {
    input.first_name = firstName;
  }
  if (lastName !== employee.last_name) {
    input.last_name = lastName;
  }
  if (!pending && email !== employee.email) {
    input.email = email;
  }
  if (position !== employee.position) {
    input.position = position;
  }
  const departmentChanged = departmentId !== employee.department_id;
  const head = departmentId != null && isHead;
  if (departmentChanged) {
    input.department_id = departmentId;
    if (head) {
      input.is_head = true;
    }
  } else if (head !== employee.is_head) {
    input.is_head = head;
  }
  if (isAdmin !== employee.is_admin) {
    input.is_admin = isAdmin;
  }
  if (blocked !== employee.blocked) {
    input.blocked = blocked;
  }
  return input;
}

interface EmployeeEditFormProps {
  employee: DirectoryEmployee;
  departments: DirectoryDepartment[];
  isSelf: boolean;
  isResettingPassword: boolean;
  isDeleting: boolean;
  isInviting: boolean;
  inviteEmailError: TranslationKeys | null;
  onInviteEmailEdit: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: () => void;
  onRequestReset: () => void;
  onRequestInvite: (email: string) => void;
}

function EmployeeEditForm({
  employee: current,
  departments,
  isSelf,
  isResettingPassword,
  isDeleting,
  isInviting,
  inviteEmailError,
  onInviteEmailEdit,
  onDirtyChange,
  onRequestDelete,
  onRequestReset,
  onRequestInvite,
}: EmployeeEditFormProps): JSX.Element {
  const [employee] = useState(current);
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const updateEmployee = useUpdateDirectoryEmployeeMutation();
  const [profile, setProfile] = useState<EmployeeProfileValues>({
    first_name: employee.first_name,
    last_name: employee.last_name,
    email: employee.email,
    position: employee.position,
    department: employee.department_id ?? NO_DEPARTMENT,
  });
  const [isAdmin, setIsAdmin] = useState(employee.is_admin);
  const [isHead, setIsHead] = useState(employee.is_head);
  const [blocked, setBlocked] = useState(employee.blocked);
  const [inviteEmail, setInviteEmail] = useState(employee.email);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const pending = isPendingInvite(employee);
  const hasDepartment = profile.department !== NO_DEPARTMENT;
  const status = statusTag(employee);

  const changes = buildChanges(employee, profile, isAdmin, isHead, blocked, pending);
  const hasChanges = Object.keys(changes).length > 0;

  useEffect(() => {
    onDirtyChange(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const handleProfileChange = (next: EmployeeProfileValues) => {
    if (next.department !== profile.department) {
      const original = employee.department_id ?? NO_DEPARTMENT;
      setIsHead(next.department === original && employee.is_head);
    }
    setProfile(next);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasChanges) {
      return;
    }
    setSaveError(null);
    updateEmployee.mutate(
      { id: employee.id, input: changes },
      {
        onSuccess: () => {
          showToast({
            message: localize("com_admin_toast_employee_updated"),
            status: "success",
          });
          navigate("/admin/users");
        },
        onError: (error) =>
          setSaveError({
            messageKey: directoryErrorKey(error),
            fields: directoryFieldErrors(error),
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-6xl space-y-6">
      <PageColumns>
        <PageCard title={localize("com_admin_employees_card_profile")}>
          <EmployeeProfileFields
            idPrefix="admin-edit-employee"
            values={profile}
            onChange={handleProfileChange}
            departments={departments}
            fieldErrors={saveError?.fields ?? {}}
            emailLocked={pending}
          />
        </PageCard>
        <PageCard title={localize("com_admin_employees_card_access")}>
          <div>
            <Tag variant={status.variant} label={localize(status.labelKey)} />
          </div>
          {pending && (
            <div className="space-y-1.5">
              <Label htmlFor="admin-edit-employee-invite-email">
                {localize("com_admin_employees_invite_email")}
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="admin-edit-employee-invite-email"
                  type="email"
                  className="min-w-0 flex-1"
                  value={inviteEmail}
                  aria-invalid={inviteEmailError != null}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    onInviteEmailEdit();
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isInviting || inviteEmail.trim() === ""}
                  onClick={() => onRequestInvite(inviteEmail.trim())}
                >
                  {localize("com_admin_employees_invite_resend")}
                </Button>
              </div>
              {inviteEmailError != null && (
                <p className="text-xs text-text-destructive" role="alert">
                  {localize(inviteEmailError)}
                </p>
              )}
            </div>
          )}
          <label className="flex items-start gap-3">
            <Checkbox
              aria-label={localize("com_admin_employees_admin")}
              checked={isAdmin}
              disabled={isSelf}
              onCheckedChange={(checked) => setIsAdmin(checked === true)}
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">
                {localize("com_admin_employees_admin")}
              </span>
              <span className="block text-xs text-text-secondary">
                {localize("com_admin_employees_admin_hint")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Checkbox
              aria-label={localize("com_admin_employees_head")}
              checked={isHead && hasDepartment}
              disabled={!hasDepartment}
              onCheckedChange={(checked) => setIsHead(checked === true)}
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">
                {localize("com_admin_employees_head")}
              </span>
              <span className="block text-xs text-text-secondary">
                {localize(
                  hasDepartment
                    ? "com_admin_employees_head_hint"
                    : "com_admin_employees_head_no_department",
                )}
              </span>
            </span>
          </label>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">
                {localize("com_admin_employees_blocked")}
              </p>
              <p className="text-xs text-text-secondary">
                {localize("com_admin_employees_blocked_hint")}
              </p>
            </div>
            <Switch
              checked={blocked}
              disabled={isSelf}
              onCheckedChange={setBlocked}
              aria-label={localize("com_admin_employees_blocked")}
            />
          </div>
          {isSelf && (
            <p className="text-xs text-text-secondary">
              {localize("com_admin_employees_own_card_hint")}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={isSelf || pending || isResettingPassword}
              title={
                isSelf
                  ? localize("com_admin_employees_reset_password_own_hint")
                  : pending
                    ? localize("com_admin_employees_reset_password_pending_hint")
                    : undefined
              }
              onClick={onRequestReset}
            >
              {localize("com_admin_employees_reset_password_action")}
            </Button>
          </div>
          <div>
            <Button asChild variant="outline">
              <Link to={`/admin/ai/users/${employee.id}`}>
                {localize("com_admin_employees_ai_settings")}
              </Link>
            </Button>
          </div>
        </PageCard>
      </PageColumns>

      {saveError != null && (
        <p className="text-xs text-text-destructive" role="alert">
          {localize(saveError.messageKey)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="submit"
          disabled={!hasChanges || updateEmployee.isLoading}
        >
          {localize("com_admin_action_save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/admin/users")}
        >
          {localize("com_admin_action_cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="sm:ml-auto"
          disabled={isSelf || isDeleting}
          title={
            isSelf ? localize("com_admin_employees_own_card_hint") : undefined
          }
          onClick={onRequestDelete}
        >
          {localize(
            pending
              ? "com_admin_employees_revoke_action"
              : "com_admin_employees_delete_action",
          )}
        </Button>
      </div>
    </form>
  );
}

export default function EmployeeEditPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const localize = useLocalize();
  const { user: currentUser } = useAuthContext();
  const employeeQuery = useDirectoryEmployeeQuery(id);
  const departmentsQuery = useDirectoryDepartmentsQuery();
  const employee = employeeQuery.data;
  const { formKey, setDirty } = useFreshFormKey(id, employee?.updated_at ?? "");
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const deleteEmployee = useDeleteDirectoryEmployeeMutation();
  const resetPassword = useResetDirectoryPasswordMutation();
  const inviteEmployee = useInviteDirectoryEmployeeMutation();
  const revokeInvite = useRevokeDirectoryInviteMutation();
  const [invite, setInvite] = useState<DirectoryInvite | null>(null);
  const [inviteEmailError, setInviteEmailError] =
    useState<TranslationKeys | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );

  const pending = employee != null && isPendingInvite(employee);

  const closePasswordDialog = () => {
    setTemporaryPassword(null);
    resetPassword.reset();
  };

  const closeInviteDialog = () => {
    setInvite(null);
    inviteEmployee.reset();
  };

  const showError = (error: unknown) =>
    showToast({ message: localize(directoryErrorKey(error)), status: "error" });

  const handleInviteError = (error: unknown) => {
    showError(error);
    const fieldError = directoryFieldErrors(error).email;
    if (fieldError != null) {
      setInviteEmailError(fieldError);
    } else if (directoryErrorCode(error) === "email_taken") {
      setInviteEmailError(directoryErrorKey(error));
    }
  };

  const backButton = (
    <Button asChild variant="outline">
      <Link to="/admin/users">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize("com_admin_employees_back_to_list")}
      </Link>
    </Button>
  );

  const renderBody = (): JSX.Element => {
    if (employeeQuery.isLoading) {
      return <LoadingState message={localize("com_admin_loading")} />;
    }
    if (employeeQuery.isError || employee == null) {
      const notFound = directoryErrorCode(employeeQuery.error) === "not_found";
      return (
        <AdminErrorState
          message={
            notFound ? localize("com_admin_employees_not_found") : undefined
          }
          onRetry={notFound ? undefined : () => employeeQuery.refetch()}
        />
      );
    }
    return (
      <EmployeeEditForm
        key={formKey}
        employee={employee}
        departments={departmentsQuery.data ?? []}
        isSelf={currentUser?.id === employee.sub}
        isResettingPassword={resetPassword.isLoading}
        isDeleting={deleteEmployee.isLoading || revokeInvite.isLoading}
        isInviting={inviteEmployee.isLoading}
        inviteEmailError={inviteEmailError}
        onInviteEmailEdit={() => setInviteEmailError(null)}
        onDirtyChange={setDirty}
        onRequestDelete={() => setConfirmingDelete(true)}
        onRequestReset={() => setConfirmingReset(true)}
        onRequestInvite={(email) => {
          setInviteEmailError(null);
          inviteEmployee.mutate(
            { id: employee.id, ...(email !== employee.email ? { email } : {}) },
            { onSuccess: setInvite, onError: handleInviteError },
          );
        }}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={
          employee == null
            ? localize("com_admin_employees_edit_title_loading")
            : localize("com_admin_employees_edit_title", {
                name: fullName(employee),
              })
        }
        action={backButton}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{renderBody()}</div>
      {employee != null && (
        <>
          <AlertDialog
            open={confirmingDelete}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmingDelete(false);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {localize(
                    pending
                      ? "com_admin_employees_invite_revoke_title"
                      : "com_admin_employees_delete_title",
                  )}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {localize(
                    pending
                      ? "com_admin_employees_invite_revoke_description"
                      : "com_admin_employees_delete_description",
                    { name: fullName(employee) },
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {localize("com_admin_action_cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmingDelete(false);
                    if (pending) {
                      revokeInvite.mutate(employee.id, {
                        onSuccess: () => {
                          showToast({
                            message: localize("com_admin_toast_invite_revoked"),
                            status: "success",
                          });
                          navigate("/admin/users");
                        },
                        onError: showError,
                      });
                      return;
                    }
                    deleteEmployee.mutate(employee.id, {
                      onSuccess: () => {
                        showToast({
                          message: localize("com_admin_toast_employee_deleted"),
                          status: "success",
                        });
                        navigate("/admin/users");
                      },
                      onError: showError,
                    });
                  }}
                >
                  {localize(
                    pending
                      ? "com_admin_employees_revoke_action"
                      : "com_admin_action_delete",
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={confirmingReset}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmingReset(false);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {localize("com_admin_employees_reset_password_title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {localize("com_admin_employees_reset_password_description")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {localize("com_admin_action_cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={resetPassword.isLoading}
                  onClick={() => {
                    setConfirmingReset(false);
                    resetPassword.mutate(employee.id, {
                      onSuccess: (data) =>
                        setTemporaryPassword(data.temporary_password),
                      onError: showError,
                    });
                  }}
                >
                  {localize("com_admin_employees_reset_password_confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {invite != null && (
            <InviteLinkDialog
              link={invite.invite_link}
              email={invite.employee.email}
              emailSent={invite.email_sent}
              onClose={closeInviteDialog}
            />
          )}

          {temporaryPassword != null && (
            <TemporaryPasswordDialog
              password={temporaryPassword}
              onClose={closePasswordDialog}
            />
          )}
        </>
      )}
    </div>
  );
}
