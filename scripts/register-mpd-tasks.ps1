# Run explicitly under a dedicated Windows backup account. No passwords in task command line.
param(
 [Parameter(Mandatory=$true)][string]$NodeExe,
 [Parameter(Mandatory=$true)][string]$EnvironmentFile,
 [string]$BackupTime='01:00',
 [string]$RestoreTime='04:00',
 [switch]$Unattended
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node=(Resolve-Path $NodeExe).Path
$envfile=(Resolve-Path $EnvironmentFile).Path
if($envfile.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Environment file must be outside repo'}
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$backup=New-ScheduledTaskAction -Execute $node -Argument ('--env-file="'+$envfile+'" scripts/backup-verified.mjs') -WorkingDirectory $root
$restore=New-ScheduledTaskAction -Execute $node -Argument ('--env-file="'+$envfile+'" scripts/restore-verified.mjs') -WorkingDirectory $root
$backupTrigger=New-ScheduledTaskTrigger -Daily -At $BackupTime
$restoreTrigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $RestoreTime
if($Unattended){
 $cred=Get-Credential -Message 'Dedicated Windows backup account with network and log-on-as-batch-job rights'
 if($null -eq $cred){throw 'Credential cancelled'}
 $password=$cred.GetNetworkCredential().Password
 try{
  Register-ScheduledTask -TaskName 'MPD-Backup-Daily' -Action $backup -Trigger $backupTrigger -User $cred.UserName -Password $password -RunLevel Limited -Settings $settings
  Register-ScheduledTask -TaskName 'MPD-Restore-Weekly' -Action $restore -Trigger $restoreTrigger -User $cred.UserName -Password $password -RunLevel Limited -Settings $settings
 }finally{$password=$null;$cred=$null}
}else{
 Register-ScheduledTask -TaskName 'MPD-Backup-Daily' -Action $backup -Trigger $backupTrigger -Principal $principal -Settings $settings
 Register-ScheduledTask -TaskName 'MPD-Restore-Weekly' -Action $restore -Trigger $restoreTrigger -Principal $principal -Settings $settings
}
Write-Host 'Tasks registered. Confirm account permissions, test each task, and enable failure alerts.'
