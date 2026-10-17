package domain

import "github.com/google/uuid"

func (e Employee) Active() bool { return !e.Blocked && e.DeletedAt == nil }

func (e Employee) Admin() bool { return e.IsAdmin && e.Active() }

func (e Employee) Head() bool { return e.IsHead && e.DepartmentID != nil && e.Active() }

func (e Employee) HeadOf(target Employee) bool {
	return e.Head() && target.DepartmentID != nil && *e.DepartmentID == *target.DepartmentID
}

func CanView(actor, target Employee) bool { return actor.Admin() || actor.HeadOf(target) }

func EditableFields(actor, target Employee) map[string]bool {
	switch {
	case actor.Admin():
		return map[string]bool{
			FieldEmail: true, FieldFirstName: true, FieldLastName: true, FieldPosition: true,
			FieldDepartment: true, FieldIsAdmin: true, FieldIsHead: true, FieldBlocked: true,
		}
	case actor.HeadOf(target):
		return map[string]bool{FieldPosition: true}
	}
	return nil
}

func CanInvite(actor Employee, departmentID *uuid.UUID) bool {
	if actor.Admin() {
		return true
	}
	return actor.Head() && departmentID != nil && *actor.DepartmentID == *departmentID
}

func headManages(actor, target Employee) bool {
	return actor.HeadOf(target) && !target.IsAdmin && !target.IsHead
}

func CanReinvite(actor, target Employee) bool {
	return actor.Admin() || headManages(actor, target)
}

func CanDelete(actor, target Employee) bool {
	return actor.Admin() || (headManages(actor, target) && target.ActivatedAt == nil)
}
