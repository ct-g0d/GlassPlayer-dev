@echo off
chcp 65001 >nul
echo 正在启动 Edge 还原 Glass Player 播放历史...
start msedge "file:///D:/GlassPlayer-dev/restore-history.html?auto=1"
exit