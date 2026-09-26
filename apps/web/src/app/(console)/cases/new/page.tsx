'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CaseForm } from '@/components/CaseForm';

/** CASE-001/002：新建用例（v2：模块默认树选中/默认模块 + 动态字段）。 */

function NewCaseForm() {
  const search = useSearchParams();
  const moduleId = search.get('moduleId') ?? undefined;
  return <CaseForm submitTestId="btn-submit-case" defaultModuleId={moduleId} />;
}

export default function NewCasePage() {
  return (
    <Suspense fallback={null}>
      <NewCaseForm />
    </Suspense>
  );
}
