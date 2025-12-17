import { useState, useEffect } from 'react';
import api from '../utils/api';
import { Upload, X } from 'lucide-react';
import { useOptions } from '/src/utils/optionsContext';
import clsx from 'clsx';

export default function ProfileSettings() {
  const { options } = useOptions();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const currentUser = api.getUser();
      if (currentUser) {
        setUser(currentUser);
        setPreview(currentUser.avatar_photo || null);
      } else {
        const data = await api.getCurrentUser();
        setUser(data.user);
        setPreview(data.user?.avatar_photo || null);
        api.setUser(data.user);
      }
    } catch (err) {
      console.error('Error loading user:', err);
      setError('Failed to load user profile');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB');
      return;
    }

    setError(null);
    setSuccess(null);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);

    // Upload immediately
    uploadAvatar(file);
  };

  const uploadAvatar = async (file) => {
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = reader.result;
          const updatedUser = await api.updateProfile({ avatar_photo: base64 });
          
          setUser(updatedUser.user);
          setPreview(updatedUser.user?.avatar_photo || null);
          api.setUser(updatedUser.user);
          setSuccess('Profile photo updated successfully');
          
          // Clear success message after 3 seconds
          setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
          console.error('Error updating profile:', err);
          setError(err.message || 'Failed to update profile photo');
          setPreview(user?.avatar_photo || null);
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read image file');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error uploading avatar:', err);
      setError(err.message || 'Failed to upload photo');
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const updatedUser = await api.updateProfile({ avatar_photo: null });
      setUser(updatedUser.user);
      setPreview(null);
      api.setUser(updatedUser.user);
      setSuccess('Profile photo removed successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error removing avatar:', err);
      setError(err.message || 'Failed to remove photo');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-gray-500">Loading profile...</div>
      </div>
    );
  }

  const containerBgColor = options.settingsContainerColor || '#ffffff';
  const isLightTheme = options.theme === 'light' || !options.theme;
  const textColor = isLightTheme ? '#111827' : '#f8fafc';
  const labelColor = isLightTheme ? '#374151' : '#9ca3af';
  const borderColor = isLightTheme ? '#e5e7eb' : '#2a2a2f';
  const secondaryBgColor = isLightTheme ? '#f3f4f6' : '#1f2937';
  const avatarBgColor = isLightTheme ? '#e5e7eb' : '#374151';

  return (
    <div className="mb-8">
      <h2 className="text-xl font-medium mb-3 px-1" style={{ color: textColor }}>Profile</h2>
      <div className="rounded-xl overflow-visible">
        <div 
          className="rounded-xl p-6 border"
          style={{ 
            backgroundColor: containerBgColor,
            borderColor: borderColor
          }}
        >
          {/* Avatar Section */}
          <div className="mb-6">
            <label 
              className="block text-sm font-medium mb-3"
              style={{ color: labelColor }}
            >
              Profile Photo
            </label>
            <div className="flex items-center gap-4">
              <div className="relative">
                <div 
                  className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: avatarBgColor }}
                >
                  {preview ? (
                    <img 
                      src={preview} 
                      alt="Profile" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span 
                      className="text-3xl"
                      style={{ color: isLightTheme ? '#6b7280' : '#9ca3af' }}
                    >
                      {(user?.name || user?.email || 'U')[0].toUpperCase()}
                    </span>
                  )}
                </div>
                {uploading && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    disabled={uploading}
                    className="hidden"
                  />
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                    <Upload size={16} />
                    {uploading ? 'Uploading...' : 'Upload Photo'}
                  </span>
                </label>
                {preview && (
                  <button
                    onClick={removeAvatar}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: secondaryBgColor,
                      color: textColor
                    }}
                    onMouseEnter={(e) => {
                      if (!uploading) {
                        e.target.style.backgroundColor = isLightTheme ? '#e5e7eb' : '#374151';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!uploading) {
                        e.target.style.backgroundColor = secondaryBgColor;
                      }
                    }}
                  >
                    <X size={16} />
                    Remove Photo
                  </button>
                )}
              </div>
            </div>
            <p 
              className="mt-2 text-xs"
              style={{ color: labelColor }}
            >
              Upload a profile photo. Maximum file size: 5MB. Supported formats: JPG, PNG, GIF.
            </p>
          </div>

          {/* User Info */}
          <div className="space-y-4">
            <div>
              <label 
                className="block text-sm font-medium mb-1"
                style={{ color: labelColor }}
              >
                Name
              </label>
              <div 
                className="text-sm"
                style={{ color: textColor }}
              >
                {user?.name || 'Not set'}
              </div>
            </div>
            <div>
              <label 
                className="block text-sm font-medium mb-1"
                style={{ color: labelColor }}
              >
                Email
              </label>
              <div 
                className="text-sm"
                style={{ color: textColor }}
              >
                {user?.email || 'Not set'}
              </div>
            </div>
          </div>

          {/* Messages */}
          {error && (
            <div 
              className="mt-4 p-3 border rounded-lg"
              style={{
                backgroundColor: isLightTheme ? '#fef2f2' : '#7f1d1d',
                borderColor: isLightTheme ? '#fecaca' : '#991b1b'
              }}
            >
              <p 
                className="text-sm"
                style={{ color: isLightTheme ? '#991b1b' : '#fecaca' }}
              >
                {error}
              </p>
            </div>
          )}
          {success && (
            <div 
              className="mt-4 p-3 border rounded-lg"
              style={{
                backgroundColor: isLightTheme ? '#f0fdf4' : '#14532d',
                borderColor: isLightTheme ? '#bbf7d0' : '#166534'
              }}
            >
              <p 
                className="text-sm"
                style={{ color: isLightTheme ? '#166534' : '#bbf7d0' }}
              >
                {success}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

