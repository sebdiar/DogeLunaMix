import clsx from 'clsx';
import { useOptions } from '/src/utils/optionsContext';

const Button = ({ value, action, disabled = false, maxW = 40, variant }) => {
  const { options } = useOptions();

  const isDanger = variant === 'danger';

  return (
    <button
      onClick={action}
      className={clsx(
        'rounded-xl border text-[0.9rem] font-medium cursor-pointer',
        'flex items-center justify-center h-10 px-4 transition-opacity duration-150',
        'hover:opacity-80 active:opacity-90',
        disabled ? 'opacity-60' : undefined,
        isDanger && 'border-red-500/50',
      )}
      style={{
        backgroundColor: isDanger ? '#dc2626' : (options.settingsDropdownColor || '#1a2a42'),
        color: isDanger ? '#ffffff' : undefined,
        maxWidth: `${maxW}rem`,
      }}
    >
      {value}
    </button>
  );
};

export default Button;
