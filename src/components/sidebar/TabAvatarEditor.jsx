import { useState } from 'react';
import { X, Upload, FileText } from 'lucide-react';

const COLORS = [
  null,
  '#4285f4',
  '#9333ea',
  '#10b981',
  '#059669',
  '#84cc16',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
];

export default function TabAvatarEditor({ isOpen, onClose, onSave, initialData = {} }) {
  const [emoji, setEmoji] = useState(initialData.emoji || '');
  const [color, setColor] = useState(initialData.color !== undefined ? initialData.color : null);
  const [photo, setPhoto] = useState(initialData.photo || null);

  const handleSave = () => {
    onSave({ emoji, color, photo });
    onClose();
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhoto(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit icon</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center relative border-4"
              style={{ 
                borderColor: color,
                color: color,
                backgroundColor: 'transparent'
              }}
            >
              {photo ? (
                <img src={photo} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              ) : emoji ? (
                <span className="text-4xl">{emoji}</span>
              ) : (
                <FileText size={32} />
              )}
              <label className="absolute bottom-0 right-0 w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center cursor-pointer hover:bg-blue-600 transition-colors">
                <Upload size={14} className="text-white" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Enter emoji or text (optional)
            </label>
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
              placeholder="😀 or A (leave empty for default icon)"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select color
            </label>
            <div className="flex gap-3 justify-center flex-wrap">
              {COLORS.map((c, idx) => (
                <button
                  key={c || 'no-color'}
                  onClick={() => setColor(c)}
                  className={`w-10 h-10 rounded-full transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ 
                    backgroundColor: c || '#f3f4f6',
                    border: c ? 'none' : '2px solid #e5e7eb'
                  }}
                  title={c ? '' : 'No color'}
                >
                  {!c && <span className="text-gray-400 text-xs">∅</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}














