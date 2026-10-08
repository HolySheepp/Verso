; Verso 安裝程式的自訂步驟（tauri NSIS hooks）
; 解除安裝時，讓使用者選要不要一起刪掉翻譯檔案和字典（預設保留）。
; 存檔資料夾的位置由 Verso 寫在設定資料夾的 saveroot.txt（UTF-16），沒有就用「文件\Verso」。

; 安裝程式跟 Windows 語言走（中文或英文），自訂步驟的字句兩種語言都要有。
; 這個檔案在載入語言之前就被引入，所以字句包成巨集，由範本在載入語言之後插入。
!macro VERSO_LANGSTRINGS
  LangString VersoAskFiles ${LANG_TRADCHINESE} "要一起刪除 Verso 的翻譯檔案嗎？$\r$\n$\r$\n位置：$VersoRoot$\r$\n只會刪 Verso 建立的檔案，資料夾裡你自己放的東西會保留。$\r$\n選「否」會保留，之後重新安裝還能繼續使用。"
  LangString VersoAskFiles ${LANG_ENGLISH} "Also delete Verso's translation files?$\r$\n$\r$\nLocation: $VersoRoot$\r$\nOnly files created by Verso are deleted. Anything else you put in the folder is kept.$\r$\nChoose No to keep them, so you can keep using them after reinstalling."
  LangString VersoAskDicts ${LANG_TRADCHINESE} "要一起刪除 Verso 的字典嗎？$\r$\n$\r$\n位置：$VersoRoot\字典$\r$\n選「否」會保留。"
  LangString VersoAskDicts ${LANG_ENGLISH} "Also delete Verso's dictionaries?$\r$\n$\r$\nLocation: $VersoRoot\字典$\r$\nChoose No to keep them."
!macroend

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
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(VersoAskFiles)" /SD IDNO IDNO +2
        StrCpy $VersoDelFiles 1
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(VersoAskDicts)" /SD IDNO IDNO +2
        StrCpy $VersoDelDicts 1
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 只刪 Verso 自己的檔案：清單 versofiles.txt 由 Verso 存檔時寫在設定資料夾（UTF-16，每行「種類|路徑」）。
  ; F 翻譯檔案與設定檔、R 暫存復原資料夾、D 字典、P／Q 專案與字典資料夾（空了才刪）。
  ; 資料夾裡使用者自己的東西一律保留，所以不會整個刪掉存檔資料夾。
  ${If} $VersoDelFiles = 1
  ${OrIf} $VersoDelDicts = 1
    ClearErrors
    FileOpen $0 "$APPDATA\${BUNDLEID}\versofiles.txt" r
    ${IfNot} ${Errors}
      ${Do}
        ClearErrors
        FileReadUTF16LE $0 $1
        ${If} ${Errors}
          ${ExitDo}
        ${EndIf}
        ; 去掉行尾的換行
        ${Do}
          StrCpy $2 $1 1 -1
          ${If} $2 == "$\r"
          ${OrIf} $2 == "$\n"
            StrCpy $1 $1 -1
          ${Else}
            ${ExitDo}
          ${EndIf}
        ${Loop}
        StrCpy $2 $1 2
        StrCpy $3 $1 "" 2
        ${If} $VersoDelFiles = 1
          ${If} $2 == "F|"
            Delete "$3"
          ${ElseIf} $2 == "R|"
            RMDir /r "$3"
          ${ElseIf} $2 == "P|"
            RMDir "$3"
          ${EndIf}
        ${EndIf}
        ${If} $VersoDelDicts = 1
          ${If} $2 == "D|"
            Delete "$3"
          ${ElseIf} $2 == "Q|"
            RMDir "$3"
          ${EndIf}
        ${EndIf}
      ${Loop}
      FileClose $0
    ${EndIf}
    ; 空了才刪
    RMDir "$VersoRoot\字典"
    RMDir "$VersoRoot"
  ${EndIf}
!macroend
