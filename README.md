# API Casa - Controle de Iluminação Inteligente

Este é um projeto local extremamente leve e responsivo para controlar a lâmpada inteligente da sua casa (EKAZA Smart Bulb A60 9W) configurada no IP fixo **`192.168.1.101`**.

O projeto conta com:
1. **Uma API em Python** (`http.server` sem dependências complexas de frameworks, ideal para rodar no Termux do Android).
2. **Um Website/Painel Web** responsivo e moderno (tema escuro com glassmorfismo e seletor de cores).

---

## 🛠️ Requisitos no Servidor (Termux / Linux)

1. **Python 3** instalado.
2. **TinyTuya**: Biblioteca para comunicação com dispositivos da Tuya.
   Instale no servidor executando:
   ```bash
   pip install tinytuya
   ```

---

## 🚀 Como Rodar o Servidor Localmente

Na pasta do projeto, execute o seguinte comando:
```bash
python app.py
```
O console exibirá algo como:
`API e Website rodando em http://localhost:4000`

Se você estiver na mesma rede local, poderá acessar o painel de qualquer dispositivo (computador, celular ou tablet) digitando o IP do servidor na barra de endereços do navegador:
`http://192.168.1.100:4000`

---

## 📥 Como Enviar/Implantar este Repositório no seu Servidor (Termux)

Você tem duas formas recomendadas de enviar este repositório para o servidor que está no IP `192.168.1.100` (porta `8022` do SSH):

### Opção 1: Via GitHub (A mais simples)

Como esse repositório já está configurado com o GitHub:

1. Faça o commit e envie suas alterações locais para o GitHub:
   ```bash
   git add .
   git commit -m "Adiciona painel web e API da lâmpada"
   git push origin main
   ```
2. Acesse seu servidor via SSH:
   ```bash
   ssh -p 8022 u0_a273@192.168.1.100
   ```
3. No servidor, clone o repositório se ainda não o fez, ou entre na pasta e puxe a atualização:
   ```bash
   # Se for a primeira vez:
   git clone https://github.com/vilelagabrielx/api-casa.git
   cd api-casa

   # Se já tiver clonado antes:
   cd api-casa
   git pull origin main
   ```
4. Inicie o servidor:
   ```bash
   python app.py
   ```

---

### Opção 2: Puxando diretamente do Computador Local (Git Direto via SSH)

Se você preferir não usar o GitHub público para sincronizar arquivos, pode puxar diretamente da sua máquina de desenvolvimento usando a rede local:

1. Acesse seu servidor via SSH:
   ```bash
   ssh -p 8022 u0_a273@192.168.1.100
   ```
2. Crie uma pasta para o projeto no servidor (se não existir):
   ```bash
   mkdir -p ~/projects/api-casa
   cd ~/projects/api-casa
   git init
   ```
3. Na sua **máquina local (Windows/computador)**, adicione o servidor como um repositório remoto:
   ```bash
   git remote add termux ssh://u0_a273@192.168.1.100:8022/data/data/com.termux/files/home/projects/api-casa
   ```
4. Agora você pode fazer push direto da sua máquina para o servidor:
   ```bash
   git push termux main
   ```
5. No servidor Termux, execute `git checkout -f` para atualizar os arquivos da pasta de trabalho local.

---

## 🔄 Como Rodar a API em Segundo Plano no Termux (Daemon)

Para que a API continue rodando mesmo após você fechar o terminal do SSH no celular:

### Usando o `nohup` (Nativo do Linux)
```bash
nohup python app.py > server.log 2>&1 &
```
*Isso criará o arquivo `server.log` com os logs do servidor e colocará o processo em background.*

Para parar o servidor mais tarde:
```bash
pkill -f app.py
```
