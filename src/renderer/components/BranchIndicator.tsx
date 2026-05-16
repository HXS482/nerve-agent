interface Props {
  branchName: string
  isActive?: boolean
}

export function BranchIndicator({ branchName, isActive = false }: Props) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        margin: '16px 0 8px',
        padding: '4px 0',
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: isActive
            ? 'rgba(173, 198, 255, 0.2)'
            : 'var(--border-subtle)',
        }}
      />
      <span
        className="text-[10px] shrink-0"
        style={{
          color: isActive ? 'var(--accent-primary)' : 'var(--text-outline)',
          fontWeight: isActive ? 600 : 400,
          padding: '2px 8px',
          borderRadius: 4,
          background: isActive
            ? 'rgba(173, 198, 255, 0.08)'
            : 'transparent',
        }}
      >
        {branchName}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: isActive
            ? 'rgba(173, 198, 255, 0.2)'
            : 'var(--border-subtle)',
        }}
      />
    </div>
  )
}
