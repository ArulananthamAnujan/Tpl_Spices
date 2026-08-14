export default function LoadingSpinner({ size = 'md', light = false }: { size?: 'sm' | 'md' | 'lg'; light?: boolean }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex items-center justify-center">
      <div className={`${sizes[size]} border-2 border-t-transparent rounded-full animate-spin ${light ? 'border-white' : 'border-tpl-lime'}`} />
    </div>
  );
}
