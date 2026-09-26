/** 统一页头：标题 + 副标题 + 右侧操作区。 */
export function PageHeader({
  title,
  sub,
  extra,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rabbit-page-header">
      <div className="flex-1 min-w-0">
        <h1>{title}</h1>
        {sub && <p className="sub mt-1 mb-0">{sub}</p>}
      </div>
      {extra && <div className="flex items-center gap-2 shrink-0">{extra}</div>}
    </div>
  );
}
