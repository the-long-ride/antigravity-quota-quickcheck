; Normalize legacy quoted paths whenever the directory page validates $INSTDIR.
; MUI owns .onGUIInit, so use NSIS's dedicated directory-validation callback.
Function .onVerifyInstDir
  ${If} $INSTDIR != ""
    StrCpy $0 $INSTDIR 1 0
    StrCpy $1 $INSTDIR 1 -1
    ${If} $0 == '"'
    ${AndIf} $1 == '"'
      StrCpy $INSTDIR $INSTDIR -1 1
    ${EndIf}
  ${EndIf}
FunctionEnd

; Persist an unquoted install location so future installers restore a clean path.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
!macroend
