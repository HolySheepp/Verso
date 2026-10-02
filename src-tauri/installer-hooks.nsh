; Verso 安裝程式的自訂步驟（tauri NSIS hooks）
; 解除安裝時，讓使用者選要不要一起刪掉翻譯檔案和字典（預設保留）。
; 存檔資料夾的位置由 Verso 寫在設定資料夾的 saveroot.txt（UTF-16），沒有就用「文件\Verso」。

Var VersoRoot
Var VersoDelFiles
Var VersoDelDicts

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $VersoDelFiles 0
  StrCpy $VersoDelDicts 0
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    StrCpy $VersoRoot "$DOCUMENTS\Verso"
    ClearErrors
    FileOpen $0 "$APPDATA\${BUNDLEID}\saveroot.txt" r
    ${IfNot} ${Errors}
      FileReadUTF16LE $0 $1
      FileClose $0
      ${If} $1 != ""
        StrCpy $VersoRoot $1
      ${EndIf}
    ${EndIf}
    ${If} ${FileExists} "$VersoRoot\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "要一起刪除所有翻譯檔案嗎？$\r$\n$\r$\n位置：$VersoRoot（字典以外的各專案資料夾）$\r$\n選「否」會保留，之後重新安裝還能繼續使用。" /SD IDNO IDNO +2
        StrCpy $VersoDelFiles 1
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "要一起刪除所有字典嗎？$\r$\n$\r$\n位置：$VersoRoot\字典$\r$\n選「否」會保留。" /SD IDNO IDNO +2
        StrCpy $VersoDelDicts 1
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $VersoDelFiles = 1
  ${AndIf} $VersoDelDicts = 1
    RMDir /r "$VersoRoot"
  ${Else}
    ${If} $VersoDelDicts = 1
      RMDir /r "$VersoRoot\字典"
    ${EndIf}
    ${If} $VersoDelFiles = 1
      ; 字典資料夾以外的專案資料夾全部刪掉
      FindFirst $0 $1 "$VersoRoot\*"
      ${DoWhile} $1 != ""
        ${If} $1 != "."
        ${AndIf} $1 != ".."
        ${AndIf} $1 != "字典"
        ${AndIf} ${FileExists} "$VersoRoot\$1\*.*"
          RMDir /r "$VersoRoot\$1"
        ${EndIf}
        FindNext $0 $1
      ${Loop}
      FindClose $0
      Delete "$VersoRoot\verso.json"
      RMDir "$VersoRoot"
    ${EndIf}
  ${EndIf}
!macroend
