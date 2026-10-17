import { useState } from 'react';

interface FreshFormKey {
  formKey: string;
  setDirty: (dirty: boolean) => void;
}

export default function useFreshFormKey(id: string, version: string | number): FreshFormKey {
  const [applied, setApplied] = useState({ id, version });
  const [dirty, setDirty] = useState(false);

  if (applied.id !== id) {
    setApplied({ id, version });
    setDirty(false);
  } else if (!dirty && applied.version !== version) {
    setApplied({ id, version });
  }

  return { formKey: `${applied.id}:${applied.version}`, setDirty };
}
