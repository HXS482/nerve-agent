interface Props {
  size?: number
  expanded?: boolean
  className?: string
}

export function SidebarToggleIcon({ size = 18, expanded = false, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="currentColor"
      className={className}
      style={expanded ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      <path d="M844.8 307.2A76.8 76.8 0 0 0 768 230.4H256A76.8 76.8 0 0 0 179.2 307.2v409.6A76.8 76.8 0 0 0 256 793.6h512a76.8 76.8 0 0 0 76.8-76.8V307.2z m51.2 409.6a128 128 0 0 1-128 128H256A128 128 0 0 1 128 716.8V307.2A128 128 0 0 1 256 179.2h512A128 128 0 0 1 896 307.2v409.6z" />
      <path d="M441.6 819.2V204.8a25.6 25.6 0 0 1 51.2 0v614.4a25.6 25.6 0 0 1-51.2 0zM341.76 302.08a25.6 25.6 0 1 1 0 51.2H279.04a25.6 25.6 0 0 1 0-51.2h62.72zM341.76 424.96a25.6 25.6 0 0 1 0 51.2H279.04a25.6 25.6 0 0 1 0-51.2h62.72z" />
    </svg>
  )
}
