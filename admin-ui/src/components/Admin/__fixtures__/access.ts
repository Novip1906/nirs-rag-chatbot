import { ALL_CAPABILITIES, HEAD_CAPABILITIES } from './capabilities';

export interface AccessFixture {
  isAdmin: boolean;
  aiCapabilities: Set<string>;
  aiRole: string | null;
  aiDepartmentId: string | null;
  canEnter: boolean;
  isLoading: boolean;
  isAiLoading: boolean;
  aiError: boolean;
  refetchAi: () => void;
  directoryError: boolean;
  refetchDirectory: () => void;
}

export function adminAccess(overrides: Partial<AccessFixture> = {}): AccessFixture {
  return {
    isAdmin: true,
    aiCapabilities: new Set(ALL_CAPABILITIES),
    aiRole: 'ADMIN',
    aiDepartmentId: null,
    canEnter: true,
    isLoading: false,
    isAiLoading: false,
    aiError: false,
    refetchAi: jest.fn(),
    directoryError: false,
    refetchDirectory: jest.fn(),
    ...overrides,
  };
}

export function headAccess(overrides: Partial<AccessFixture> = {}): AccessFixture {
  return adminAccess({
    isAdmin: false,
    aiCapabilities: new Set(HEAD_CAPABILITIES),
    aiRole: 'HEAD',
    aiDepartmentId: 'dept-1',
    ...overrides,
  });
}
