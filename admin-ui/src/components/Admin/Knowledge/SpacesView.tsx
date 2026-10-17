import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  EmptyState,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  Tag,
} from '@librechat/client';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AdminDepartment } from '~/api';
import type { KnowledgeSpaceItem } from '~/api';
import { SystemRoles } from '~/api';
import { useAdminDepartmentsQuery } from '~/data-provider/Admin';
import { useDeleteSpaceMutation, useKnowledgeSpacesQuery } from '~/data-provider/Knowledge';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { formatCount } from '~/components/Admin/utils/format';
import { useCapabilities, useLocalize } from '~/hooks';

/**
 * `headOwnDepartment` покрывает главу отдельно от общего справочника: `GET /departments`
 * ей недоступен (403, админ-уровень), так что `departments` для неё всегда пуст — без
 * этой пары id/название её собственный отдел показывался бы сырым `ObjectId`, как и
 * было до фикса. Для админа `headOwnDepartment` не передаётся, справочник и так полон.
 */
function departmentNames(
  ids: string[],
  departments: AdminDepartment[],
  headOwnDepartment: { id: string; name: string } | null,
): string[] {
  const byId = new Map(departments.map((department) => [department.id, department.name]));
  if (headOwnDepartment != null) {
    byId.set(headOwnDepartment.id, headOwnDepartment.name);
  }
  return ids.map((id) => byId.get(id) ?? id);
}

/**
 * Зеркалит серверную `spaceAllowsDepartment` (`packages/api/src/admin/corporate/knowledge.ts`):
 * для главы отдела кнопки правки и удаления показываются только там, где сервер их и правда
 * пропустит. Сам список пространств уже отфильтрован по отделу главы на сервере, так что
 * этой проверке скорее не с чем не совпасть — но не полагаемся на это молча: без неё
 * рассинхронизация фильтра списка с проверкой в обработчике осталась бы незамеченной.
 */
function headCanManageSpace(space: KnowledgeSpaceItem, headDepartmentId: string | null): boolean {
  if (headDepartmentId == null) {
    return true;
  }
  return space.allowedDepartments.includes(headDepartmentId);
}

export default function SpacesView(): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { capabilities, role, departmentId, departmentName } = useCapabilities();
  const spacesQuery = useKnowledgeSpacesQuery();
  const isDepartmentHead = role === SystemRoles.HEAD;
  /**
   * `GET /departments` требует админ-уровня — для главы он бы просто 403-ился на
   * каждом заходе на этот экран, без пользы (свой отдел она узнаёт из `useCapabilities()`
   * ниже) и с лишним шумом в консоли на каждый retry react-query.
   */
  const departmentsQuery = useAdminDepartmentsQuery({ enabled: !isDepartmentHead });
  const deleteSpace = useDeleteSpaceMutation();
  const [deletingSpace, setDeletingSpace] = useState<KnowledgeSpaceItem | null>(null);

  const spaces = spacesQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  /**
   * Создание, правка и удаление пространства — за `manage:knowledge_documents`, тем же
   * полномочием, что и работа с документами: у главы отдела оно есть, но сервер
   * ограничивает её пространствами своего отдела (`departmentScope`) — та же граница
   * повторяется здесь через `headDepartmentId`/`headCanManageSpace`, чтобы не показывать
   * кнопку там, где сервер всё равно откажет.
   */
  const canManageKnowledge = capabilities.has('manage:knowledge_documents');
  const headDepartmentId = isDepartmentHead ? departmentId : null;
  const headOwnDepartment =
    headDepartmentId != null && departmentName != null
      ? { id: headDepartmentId, name: departmentName }
      : null;
  /**
   * Глава без отдела — некорректное, но теоретически достижимое состояние (см.
   * `resolveRequestDepartmentScope`, который в этом случае отвечает 400): кнопку
   * создания прячем, а не оставляем вести на форму, которая гарантированно откажет.
   */
  const canCreateSpace = canManageKnowledge && (!isDepartmentHead || headDepartmentId != null);

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_knowledge_title')}
        description={localize('com_admin_knowledge_description')}
        action={
          canCreateSpace ? (
            <Button asChild variant="submit">
              <Link to="/admin/knowledge/new">
                <Plus className="size-4" aria-hidden="true" />
                {localize('com_admin_knowledge_create')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {spacesQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {spacesQuery.isError && <AdminErrorState onRetry={() => spacesQuery.refetch()} />}
        {!spacesQuery.isLoading && !spacesQuery.isError && spaces.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title={localize('com_admin_knowledge_empty_title')}
            description={localize('com_admin_knowledge_empty_description')}
          />
        )}
        {!spacesQuery.isLoading && !spacesQuery.isError && spaces.length > 0 && (
          <Panel className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_knowledge_col_name')}</TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_departments')}</TableHead>
                    <TableHead className="text-right">
                      {localize('com_admin_knowledge_col_documents')}
                    </TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_status')}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{localize('com_admin_knowledge_col_actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spaces.map((space) => {
                    const canManageThisSpace =
                      canManageKnowledge && headCanManageSpace(space, headDepartmentId);
                    return (
                      <TableRow
                        key={space.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/admin/knowledge/${space.id}`)}
                      >
                        <TableRowHeader>
                          <div className="min-w-0">
                            <Link
                              to={`/admin/knowledge/${space.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="block truncate font-medium text-text-primary hover:underline focus-visible:underline"
                            >
                              {space.name}
                            </Link>
                            {space.description !== '' && (
                              <p className="truncate text-xs text-text-secondary">
                                {space.description}
                              </p>
                            )}
                          </div>
                        </TableRowHeader>
                        <TableCell className="max-w-xs">
                          <span className="line-clamp-2 text-sm text-text-secondary">
                            {space.allowedDepartments.length > 0
                              ? departmentNames(
                                  space.allowedDepartments,
                                  departments,
                                  headOwnDepartment,
                                ).join(', ')
                              : localize('com_admin_knowledge_departments_all')}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(space.documentCount)}
                        </TableCell>
                        <TableCell>
                          <Tag
                            variant={space.enabled ? 'success' : 'info'}
                            label={localize(
                              space.enabled
                                ? 'com_admin_knowledge_status_enabled'
                                : 'com_admin_knowledge_status_disabled',
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canManageThisSpace && (
                              <>
                                <IconButton
                                  label={localize('com_admin_knowledge_edit')}
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    navigate(`/admin/knowledge/${space.id}/edit`);
                                  }}
                                >
                                  <Pencil className="size-4" aria-hidden="true" />
                                </IconButton>
                                <IconButton
                                  label={localize('com_admin_knowledge_delete')}
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeletingSpace(space);
                                  }}
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                </IconButton>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </div>
      <AlertDialog
        open={deletingSpace != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingSpace(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{localize('com_admin_knowledge_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {localize('com_admin_knowledge_delete_description', {
                name: deletingSpace?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{localize('com_admin_action_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingSpace != null) {
                  deleteSpace.mutate(deletingSpace.id);
                  setDeletingSpace(null);
                }
              }}
            >
              {localize('com_admin_action_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
