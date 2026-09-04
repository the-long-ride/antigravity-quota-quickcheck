; MUI owns .onGUIInit. Register a MUI-safe callback that runs after .onInit
; restores $INSTDIR but before the first installer page is displayed.
!define MUI_CUSTOMFUNCTION_GUIINIT NormalizeInstallDir

Function NormalizeInstallDir
  ; Trim a legacy leading quote if present.
  StrCpy $0 $INSTDIR 1
  StrCmp $0 `"` 0 +2
    StrCpy $INSTDIR $INSTDIR "" 1

  ; Trim a legacy trailing quote if present.
  StrCpy $0 $INSTDIR 1 -1
  StrCmp $0 `"` 0 +2
    StrCpy $INSTDIR $INSTDIR -1
FunctionEnd

; Persist an unquoted install location so future installers restore a clean path.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
!macroend
