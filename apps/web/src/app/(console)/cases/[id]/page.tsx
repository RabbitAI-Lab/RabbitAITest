import { CaseForm } from '@/components/CaseForm';

export default async function EditCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseForm caseId={id} />;
}
