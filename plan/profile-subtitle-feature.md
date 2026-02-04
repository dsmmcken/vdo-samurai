# Plan: Add Subtitle Field to User Profile

## Overview

Update the user profile system to capture three fields for video export lower-third display:

1. **Display Name** - Short name shown to peers during the session (existing)
2. **Full Name** - Complete name displayed in the lower-third when introduced on screen
3. **Subtitle** - Job title or role displayed below the full name in the lower-third

These fields will be used when generating video exports with professional lower-third graphics that introduce participants on screen.

## Files to Modify

### 1. `src/store/userStore.ts`
- Add `subtitle` field to `UserProfile` interface
- Update `isProfileComplete()` to NOT require subtitle (optional field)
- Ensure persistence handles the new field

**Changes:**
```typescript
export interface UserProfile {
  displayName: string;    // Short name for session peers
  fullName: string;       // Full name for lower-third display
  subtitle: string;       // Job title/role for lower-third display
}
```

### 2. `src/components/user/ProfileSetup.tsx`
- Add subtitle input field with placeholder "e.g., Software Engineer"
- Add helper text explaining the lower-third usage
- Subtitle is optional - form is valid without it
- Update submit handler to include subtitle

**UI Layout:**
```
┌─────────────────────────────────────────┐
│         Welcome to VDO Samurai          │
│                                         │
│  Display Name                           │
│  ┌─────────────────────────────────┐    │
│  │ Sam                             │    │
│  └─────────────────────────────────┘    │
│  Shown to other participants            │
│                                         │
│  Full Name                              │
│  ┌─────────────────────────────────┐    │
│  │ Samantha Chen                   │    │
│  └─────────────────────────────────┘    │
│  Displayed in video lower-third         │
│                                         │
│  Subtitle                               │
│  ┌─────────────────────────────────┐    │
│  │ Senior Product Designer         │    │
│  └─────────────────────────────────┘    │
│  Job title shown below your name        │
│                                         │
│           [ Get Started ]               │
└─────────────────────────────────────────┘
```

### 3. `src/components/user/UserPopover.tsx`
- Add subtitle to view mode display
- Add subtitle input to edit mode
- Update save handler to include subtitle

### 4. `src/components/layout/MainLayout.tsx`
- No change needed - subtitle is optional, only displayName and fullName are required

## Design Decisions

### Subtitle is Optional
- Users may not always have a job title to display
- Can leave blank if not needed for a particular recording
- Lower-third logic can handle missing subtitle gracefully (just show name)

### Validation
- Display Name: Required, non-empty
- Full Name: Required, non-empty
- Subtitle: Optional, can be empty string

### Migration
- Existing profiles without subtitle will have `subtitle: undefined`
- Handle gracefully with fallback to empty string: `profile?.subtitle || ''`

## Implementation Steps

- [ ] 1. Update `src/store/userStore.ts` - Add `subtitle` to `UserProfile` interface
- [ ] 2. Update `src/components/user/ProfileSetup.tsx` - Add subtitle input with helper text
- [ ] 3. Update `src/components/user/UserPopover.tsx` - Add subtitle to view/edit modes
- [ ] 4. Test: Clear localStorage and verify new profile setup flow works
- [ ] 5. Test: Edit existing profile and verify subtitle can be added/modified

## Future Considerations

This plan focuses on capturing the subtitle data. The actual lower-third rendering in video exports will be handled separately when implementing the composite video export feature with participant introductions.
