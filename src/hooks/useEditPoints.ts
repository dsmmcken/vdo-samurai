import { useEffect, useCallback } from 'react';
import { useRecordingStore, type EditPoint } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';

export function useEditPoints() {
  const { isRecording, startTime, addEditPoint, editPoints } = useRecordingStore();
  const { focusedPeerId } = useSessionStore();

  // Log focus changes as edit points during recording
  useEffect(() => {
    if (isRecording && startTime) {
      const point: EditPoint = {
        timestamp: Date.now() - startTime,
        focusedPeerId,
        type: 'focus-change'
      };
      addEditPoint(point);
    }
  }, [focusedPeerId, isRecording, startTime, addEditPoint]);

  const addMarker = useCallback(() => {
    if (isRecording && startTime) {
      const point: EditPoint = {
        timestamp: Date.now() - startTime,
        focusedPeerId,
        type: 'marker'
      };
      addEditPoint(point);
    }
  }, [isRecording, startTime, focusedPeerId, addEditPoint]);

  return { editPoints, addMarker };
}
