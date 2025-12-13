import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Loader() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleMsg = (e) => {
      if (e.data?.action === 'navigate' && e.data?.to) {
        navigate(e.data.to);
      }
    };

    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [navigate]);

  return (
    <div className="fixed inset-0 w-full h-full m-0 p-0 overflow-hidden" style={{ zIndex: 9999 }}>
      <iframe
        src="/src/static/loader.html"
        className="w-full h-full border-none m-0 p-0"
        style={{ display: 'block' }}
      />
    </div>
  );
}
